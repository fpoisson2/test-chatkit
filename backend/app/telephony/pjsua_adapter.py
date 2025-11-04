"""Adaptateur PJSUA pour la téléphonie SIP/RTP.

Ce module fournit une interface Python async pour PJSIP (via pjsua2),
permettant de gérer:
- Enregistrement SIP (REGISTER)
- Appels entrants (INVITE entrant)
- Appels sortants (INVITE sortant)
- Média RTP/RTCP avec support de codecs audio

PJSUA gère nativement le SIP et le RTP, ce qui simplifie grandement
l'implémentation par rapport à une solution séparée.
"""

from __future__ import annotations

import asyncio
import audioop
import logging
import queue
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("chatkit.telephony.pjsua")
logger.setLevel(logging.INFO)  # Niveau INFO pour diagnostics du conference bridge

# Import conditionnel de pjsua2
PJSUA_AVAILABLE = False
try:
    import pjsua2 as pj
    PJSUA_AVAILABLE = True
    logger.info("PJSUA2 chargé avec succès")
except ImportError as e:
    logger.warning("pjsua2 n'est pas disponible: %s", e)
    pj = None  # type: ignore


def _is_invalid_conference_disconnect_error(error: Exception) -> bool:
    """Return True if the exception represents a benign PJ_EINVAL error."""

    message = str(error) if error else ""
    if "EINVAL" in message or "70004" in message:
        return True

    if PJSUA_AVAILABLE and isinstance(error, pj.Error):  # type: ignore[has-type]
        status = getattr(error, "status", None)
        if status in {getattr(pj, "PJ_EINVAL", 70004), 70004}:
            return True

    return False


def _is_session_terminated_error(error: Exception) -> bool:
    """Return True if the exception represents ESESSIONTERMINATED (171140).

    Ces erreurs sont normales quand on tente d'opérer sur un appel déjà terminé
    et doivent être loggées en DEBUG au lieu de WARNING pour éviter le bruit.
    """
    message = str(error).lower() if error else ""

    # Vérifier le message d'erreur
    if "already terminated" in message or "esessionterminated" in message or "171140" in message:
        return True

    # Vérifier le code d'erreur PJSIP
    if PJSUA_AVAILABLE and isinstance(error, pj.Error):  # type: ignore[has-type]
        status = getattr(error, "status", None)
        # PJSIP_ESESSIONTERMINATED = 171140
        if status == 171140:
            return True

    return False


@dataclass
class PJSUAConfig:
    """Configuration pour un compte SIP PJSUA."""

    # Identité SIP
    sip_uri: str  # Ex: sip:user@domain.com
    registrar_uri: str  # Ex: sip:domain.com

    # Authentification
    username: str
    password: str

    # Transport
    transport: str = "UDP"  # UDP, TCP, TLS
    port: int = 5060

    # Paramètres d'enregistrement
    register: bool = True
    register_timeout: int = 300  # secondes

    # Paramètres audio
    local_host: str = "0.0.0.0"


@dataclass
class CallInfo:
    """Informations sur un appel PJSUA."""

    call_id: int
    remote_uri: str
    state: str
    state_text: str
    local_contact: str
    remote_contact: str
    has_media: bool = False


class PJSUAAccount(pj.Account if PJSUA_AVAILABLE else object):
    """Callback pour un compte SIP PJSUA."""

    def __init__(self, adapter: PJSUAAdapter):
        if PJSUA_AVAILABLE:
            super().__init__()
        self.adapter = adapter
        self._call_id: int | None = None

    def onRegState(self, prm: Any) -> None:
        """Appelé lors d'un changement d'état d'enregistrement."""
        if not PJSUA_AVAILABLE:
            return

        ai = self.getInfo()
        logger.info(
            "Enregistrement SIP: %s (code=%d, reason=%s)",
            ai.regStatusText,
            ai.regStatus,
            ai.regLastErr,
        )

        # Notifier l'adaptateur du changement d'état
        if hasattr(self.adapter, '_on_reg_state'):
            try:
                asyncio.run_coroutine_threadsafe(
                    self.adapter._on_reg_state(ai.regIsActive),
                    self.adapter._loop
                )
            except Exception as e:
                logger.exception("Erreur dans onRegState callback: %s", e)

    def onIncomingCall(self, prm: Any) -> None:
        """Appelé lors d'un appel entrant."""
        if not PJSUA_AVAILABLE:
            return

        call = PJSUACall(self.adapter, call_id=prm.callId)
        call_info = call.getInfo()

        logger.info(
            "Appel SIP entrant de %s",
            call_info.remoteUri,
        )

        # Notifier l'adaptateur de l'appel entrant
        if hasattr(self.adapter, '_on_incoming_call'):
            try:
                asyncio.run_coroutine_threadsafe(
                    self.adapter._on_incoming_call(call, call_info),
                    self.adapter._loop
                )
            except Exception as e:
                logger.exception("Erreur dans onIncomingCall callback: %s", e)


class AudioMediaPort(pj.AudioMediaPort if PJSUA_AVAILABLE else object):
    """Port audio personnalisé pour capturer et injecter l'audio.

    Supporte deux modes:
    - Mode PULL (recommandé): utilise audio_bridge.get_next_frame_8k()
    - Mode PUSH (legacy): utilise _outgoing_audio_queue
    """

    def __init__(
        self,
        adapter: PJSUAAdapter,
        frame_requested_event: asyncio.Event | None = None,
        audio_bridge: Any | None = None,
    ):
        if not PJSUA_AVAILABLE:
            return

        # Configuration du port audio
        # PJSUA utilise 8kHz, 16-bit, mono pour la téléphonie
        self.adapter = adapter
        self._frame_requested_event = frame_requested_event  # Event spécifique à cet appel
        self._audio_bridge = audio_bridge  # Bridge pour mode PULL (optionnel)
        self.sample_rate = 8000
        self.channels = 1
        self.samples_per_frame = 160  # 20ms @ 8kHz
        self.bits_per_sample = 16

        # Files pour l'audio (mode PUSH legacy)
        # NOTE: Si audio_bridge est fourni, ces queues ne sont plus utilisées
        self._incoming_audio_queue = queue.Queue(maxsize=100)  # Du téléphone
        self._outgoing_audio_queue = queue.Queue(maxsize=1000)  # Vers le téléphone - 20s max

        # Compteurs pour diagnostics
        self._frame_count = 0
        self._audio_frame_count = 0
        self._silence_frame_count = 0
        self._frame_received_count = 0

        # Flag pour arrêter le traitement après la déconnexion de l'appel
        self._active = True

        # Cooldown counter: force recreate après 2 réutilisations
        self._reuse_count = 0  # Nombre de fois que ce port a été réutilisé

        # Initialiser le port
        super().__init__()

        # Créer la configuration du port
        port_info = pj.MediaFormatAudio()
        port_info.clockRate = self.sample_rate
        port_info.channelCount = self.channels
        port_info.bitsPerSample = self.bits_per_sample
        port_info.frameTimeUsec = 20000  # 20ms

        self.createPort("chatkit_audio", port_info)

    def onFrameRequested(self, frame: pj.MediaFrame) -> None:
        """Appelé par PJSUA pour obtenir de l'audio à envoyer au téléphone.

        Mode PULL (recommandé): utilise audio_bridge.get_next_frame_8k()
        Mode PUSH (legacy): utilise _outgoing_audio_queue

        Note: PJSUA gère automatiquement l'encodage du codec (PCM → PCMU).
        Ce callback doit fournir du PCM linéaire 16-bit, pas du µ-law.
        """
        if not PJSUA_AVAILABLE:
            return

        # Si le port a été désactivé (appel terminé), envoyer du silence sans incrémenter les compteurs
        if not self._active:
            expected_size = self.samples_per_frame * 2  # 320 bytes
            frame.buf.clear()
            for _ in range(expected_size):
                frame.buf.append(0)
            frame.size = expected_size
            frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO
            return

        self._frame_count += 1

        # Au premier appel, signaler que PJSUA est prêt à consommer l'audio
        # CRITIQUE: Utiliser l'event spécifique à cet appel, pas un event global
        if self._frame_count == 1 and self._frame_requested_event and not self._frame_requested_event.is_set():
            logger.info("🎬 Premier onFrameRequested - PJSUA est prêt à consommer l'audio (mode %s)",
                       "PULL" if self._audio_bridge else "PUSH")
            self._frame_requested_event.set()

        expected_size = self.samples_per_frame * 2  # 320 bytes pour 160 samples @ 16-bit

        # MODE PULL: utiliser audio_bridge.get_next_frame_8k()
        if self._audio_bridge:
            try:
                audio_data = self._audio_bridge.get_next_frame_8k()
                self._audio_frame_count += 1

                # Vérifier si c'est du silence
                is_silence = all(b == 0 for b in audio_data[:min(20, len(audio_data))])

                if not is_silence:
                    if self._audio_frame_count <= 5 or (self._audio_frame_count <= 20):
                        logger.info("📢 PULL #%d: audio frame (%d bytes)",
                                   self._frame_count, len(audio_data))
                else:
                    self._silence_frame_count += 1

                # S'assurer que la taille est correcte
                if len(audio_data) < expected_size:
                    audio_data += b'\x00' * (expected_size - len(audio_data))
                elif len(audio_data) > expected_size:
                    audio_data = audio_data[:expected_size]

                # Copier les données PCM
                frame.buf.clear()
                for byte in audio_data:
                    frame.buf.append(byte)

                frame.size = len(audio_data)
                frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO

            except Exception as e:
                logger.warning("Erreur PULL get_next_frame_8k: %s, envoi silence", e)
                self._silence_frame_count += 1
                frame.buf.clear()
                for _ in range(expected_size):
                    frame.buf.append(0)
                frame.size = expected_size
                frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO

        # MODE PUSH (legacy): utiliser _outgoing_audio_queue
        else:
            try:
                # Récupérer l'audio de la queue (non-bloquant)
                audio_data = self._outgoing_audio_queue.get_nowait()
                self._audio_frame_count += 1

                # Vérifier si c'est vraiment de l'audio (pas du silence)
                is_silence = all(b == 0 for b in audio_data[:min(20, len(audio_data))])

                if self._audio_frame_count <= 5 or (self._audio_frame_count <= 20 and not is_silence):
                    logger.info("📢 PUSH #%d: audio trouvé (%d bytes) - %s",
                               self._frame_count, len(audio_data),
                               "SILENCE" if is_silence else f"AUDIO (premiers bytes: {list(audio_data[:10])})")

                # S'assurer que la taille est correcte
                if len(audio_data) < expected_size:
                    # Padding avec du silence si nécessaire
                    audio_data += b'\x00' * (expected_size - len(audio_data))
                elif len(audio_data) > expected_size:
                    # Tronquer si trop long
                    audio_data = audio_data[:expected_size]

                # Redimensionner le buffer et copier les données PCM
                frame.buf.clear()
                for byte in audio_data:
                    frame.buf.append(byte)

                frame.size = len(audio_data)
                frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO

            except queue.Empty:
                # Pas d'audio disponible, envoyer du silence PCM (0x00)
                self._silence_frame_count += 1

                if self._silence_frame_count <= 5 or self._silence_frame_count % 50 == 0:
                    logger.debug("🔇 PUSH #%d: queue vide, envoi silence (total silence: %d)",
                               self._frame_count, self._silence_frame_count)

                frame.buf.clear()
                for _ in range(expected_size):
                    frame.buf.append(0)

                frame.size = expected_size
                frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO

    def onFrameReceived(self, frame: pj.MediaFrame) -> None:
        """Appelé par PJSUA quand de l'audio est reçu du téléphone.

        Note: PJSUA gère automatiquement le décodage du codec (PCMU → PCM).
        Ce callback reçoit déjà du PCM linéaire 16-bit décodé.

        CRITIQUE: Avec null sound device, ce callback N'EST APPELÉ QUE SI:
        - Les connexions conference bridge sont établies (startTransmit)
        - Le slot de l'appel est connecté à notre port custom
        Si on reçoit du silence ici, c'est que le conference mixer n'est pas armé!
        """
        if not PJSUA_AVAILABLE:
            return

        # Log pour diagnostiquer si ce callback est bien appelé
        if not hasattr(self, '_frame_received_count'):
            self._frame_received_count = 0
        self._frame_received_count += 1

        if self._frame_received_count <= 10:
            logger.info("📥 onFrameReceived appelé #%d: type=%s, size=%d, buf_len=%d",
                       self._frame_received_count, frame.type, frame.size, len(frame.buf) if frame.buf else 0)

        if frame.type == pj.PJMEDIA_FRAME_TYPE_AUDIO and frame.buf:
            try:
                # OPTIMISATION CRITIQUE: Minimiser le traitement dans le callback pour libérer le GIL rapidement
                # Ne faire que la copie minimale + put_nowait(), pas de calculs coûteux ici
                audio_pcm = bytes(frame.buf[:frame.size])

                # Ajouter l'audio PCM à la queue pour traitement async
                # IMPORTANT: Ceci doit être ULTRA-RAPIDE pour éviter de bloquer PJSUA
                self._incoming_audio_queue.put_nowait(audio_pcm)

                # Logging minimal (seulement pour debug)
                if self._frame_received_count <= 5:
                    logger.info("✅ Frame #%d ajoutée à queue (%d bytes, queue=%d)",
                               self._frame_received_count, len(audio_pcm), self._incoming_audio_queue.qsize())

                # Notifier l'adaptateur qu'il y a de l'audio
                if hasattr(self.adapter, '_on_audio_received'):
                    try:
                        asyncio.run_coroutine_threadsafe(
                            self.adapter._on_audio_received(audio_pcm),
                            self.adapter._loop
                        )
                    except Exception as e:
                        logger.debug("Erreur notification audio reçu: %s", e)
            except queue.Full:
                logger.warning("Queue audio entrante pleine, frame ignorée")
        else:
            if self._frame_received_count <= 10:
                logger.warning("⚠️ Frame reçue mais type=%s ou buf vide", frame.type)

    def send_audio(self, audio_data: bytes) -> None:
        """Envoie de l'audio vers le téléphone (appelé depuis l'async loop)."""
        try:
            self._outgoing_audio_queue.put_nowait(audio_data)

            # Log des premières fois pour confirmer que l'audio arrive
            queue_size = self._outgoing_audio_queue.qsize()
            if self._audio_frame_count < 5:
                # Vérifier si c'est du silence
                is_silence = all(b == 0 for b in audio_data[:min(20, len(audio_data))])
                logger.info("📥 send_audio: %d bytes ajoutés à queue (taille: %d) - %s",
                           len(audio_data), queue_size,
                           "SILENCE" if is_silence else f"AUDIO (premiers bytes: {list(audio_data[:10])})")
        except queue.Full:
            logger.warning("⚠️ Queue audio sortante pleine, frame ignorée")

    async def get_audio(self) -> bytes | None:
        """Récupère l'audio reçu du téléphone (appelé depuis l'async loop)."""
        try:
            return self._incoming_audio_queue.get_nowait()
        except queue.Empty:
            return None

    def clear_incoming_audio_queue(self) -> int:
        """Vide la queue audio entrante (utilisé pour supprimer le silence initial).

        Returns:
            Nombre de frames vidées
        """
        count = 0
        try:
            while True:
                self._incoming_audio_queue.get_nowait()
                count += 1
        except queue.Empty:
            pass
        return count

    def clear_outgoing_audio_queue(self) -> int:
        """Vide la queue audio sortante (utilisé lors d'interruptions).

        Returns:
            Nombre de frames vidées
        """
        count = 0
        try:
            while True:
                self._outgoing_audio_queue.get_nowait()
                count += 1
        except queue.Empty:
            pass

        if count > 0:
            logger.info("🗑️  Queue audio sortante vidée: %d frames supprimées", count)

        return count

    def deactivate(self, *, destroy_port: bool = True) -> None:
        """Désactive le port audio et vide les queues (appelé quand l'appel se termine).

        Cela empêche PJSUA de continuer à envoyer de l'audio depuis ce port même après
        la déconnexion de l'appel, ce qui causait l'envoi continu de silence.
        """
        logger.info("🛑 Désactivation du port audio (arrêt du traitement des frames)")
        self._active = False

        # Vider les queues pour libérer la mémoire
        incoming_cleared = 0
        outgoing_cleared = 0

        try:
            while True:
                self._incoming_audio_queue.get_nowait()
                incoming_cleared += 1
        except queue.Empty:
            pass

        try:
            while True:
                self._outgoing_audio_queue.get_nowait()
                outgoing_cleared += 1
        except queue.Empty:
            pass

        if incoming_cleared > 0 or outgoing_cleared > 0:
            logger.info(
                "🗑️  Queues audio vidées: %d frames entrantes, %d frames sortantes",
                incoming_cleared,
                outgoing_cleared,
            )

        # Détruire explicitement le port si l'API pjsua2 expose destroyPort().
        destroy_port_fn = getattr(self, "destroyPort", None)
        if destroy_port and callable(destroy_port_fn):
            try:
                destroy_port_fn()
                logger.debug("🗑️  Port audio détruit (destroyPort)")
            except Exception as exc:  # pragma: no cover - dépend du backend C++
                logger.debug("Ignorer erreur destroyPort: %s", exc)

    def prepare_for_pool(self) -> None:
        """Stop activity but keep the port alive for future reuse.

        CRITICAL: Active drain to handle race condition where audio frames
        arrive from PJSUA jitter buffer after disconnect.
        """
        import time

        self.deactivate(destroy_port=False)
        self._frame_requested_event = None

        # ACTIVE DRAIN: Wait for residual frames to exit PJSUA jitter buffer
        # Race condition: frames can arrive AFTER deactivate() completes
        # Solution: Keep draining for a short period (50ms) to catch stragglers
        drain_timeout = 0.05  # 50ms - enough for ~2-3 frames @ 20ms
        drain_start = time.monotonic()
        total_drained = 0

        while (time.monotonic() - drain_start) < drain_timeout:
            drained_this_pass = 0

            # Drain incoming queue
            try:
                while True:
                    self._incoming_audio_queue.get_nowait()
                    drained_this_pass += 1
                    total_drained += 1
            except queue.Empty:
                pass

            # If we drained something, reset timeout to catch more
            if drained_this_pass > 0:
                drain_start = time.monotonic()
                logger.debug(
                    "🔄 Active drain: cleared %d residual frames, continuing...",
                    drained_this_pass
                )
            else:
                # Nothing drained - sleep briefly before retry
                time.sleep(0.005)  # 5ms

        if total_drained > 0:
            logger.info(
                "✅ Active drain complete: %d residual frames removed after deactivate",
                total_drained
            )

    def prepare_for_new_call(
        self, frame_requested_event: asyncio.Event | None, audio_bridge: Any | None = None
    ) -> None:
        """Reset counters and state before reusing the port."""

        self._frame_requested_event = frame_requested_event
        self._audio_bridge = audio_bridge  # Mettre à jour le bridge pour le nouvel appel
        self._frame_count = 0
        self._audio_frame_count = 0
        self._silence_frame_count = 0
        self._frame_received_count = 0
        self._active = True

        # S'assurer que les queues sont bien vides avant de repartir
        incoming_count = 0
        try:
            while True:
                self._incoming_audio_queue.get_nowait()
                incoming_count += 1
        except queue.Empty:
            pass

        outgoing_count = 0
        try:
            while True:
                self._outgoing_audio_queue.get_nowait()
                outgoing_count += 1
        except queue.Empty:
            pass

        # 📊 Diagnostic: Enregistrer l'état des buffers avant vidage
        if audio_bridge and hasattr(audio_bridge, '_chatkit_call_id') and audio_bridge._chatkit_call_id:
            from .call_diagnostics import get_diagnostics_manager
            diag_manager = get_diagnostics_manager()
            diag = diag_manager.get_call(audio_bridge._chatkit_call_id)
            if diag:
                diag.add_buffer_state('incoming_queue_before_call', incoming_count)
                diag.add_buffer_state('outgoing_queue_before_call', outgoing_count)


class PJSUACall(pj.Call if PJSUA_AVAILABLE else object):
    """Callback pour un appel PJSUA."""

    def __init__(self, adapter: PJSUAAdapter, call_id: int | None = None, acc: Any = None):
        if PJSUA_AVAILABLE:
            if call_id is not None:
                super().__init__(acc or adapter._account, call_id)
            else:
                super().__init__(acc or adapter._account)
        self.adapter = adapter
        self._media_active = False
        self._audio_port: AudioMediaPort | None = None
        self._audio_media: Any = None  # Référence au AudioMedia pour stopTransmit()
        self._conference_connected = False
        self._call_slot_id: int | None = None
        self._custom_port_slot_id: int | None = None

        # CRITIQUE: Chaque appel doit avoir son propre event pour savoir quand PJSUA est prêt
        # Utiliser un event partagé cause des problèmes sur les 2e/3e appels
        self._frame_requested_event = asyncio.Event() if adapter._loop else None

        # Flags de statut pour éviter les appels post-mortem
        # _terminated: True dès DISCONNECTED - empêche tout hangup/getInfo ultérieur
        # _closed: True après close_pipeline - empêche double cleanup
        # _cleanup_done: True après cleanup complet - pour backward compat
        self._terminated = False
        self._closed = False
        self._cleanup_done = False

        # 📊 Diagnostic: call_id ChatKit (UUID) pour tracer les métriques
        self.chatkit_call_id: str | None = None

    def onCallState(self, prm: Any) -> None:
        """Appelé lors d'un changement d'état d'appel."""
        if not PJSUA_AVAILABLE:
            return

        ci = self.getInfo()
        logger.info(
            "📞 onCallState - call_id=%s, state=%d (%s), remote=%s",
            ci.id,
            ci.state,
            ci.stateText,
            ci.remoteUri,
        )

        # Notifier l'adaptateur du changement d'état
        if hasattr(self.adapter, '_on_call_state'):
            try:
                asyncio.run_coroutine_threadsafe(
                    self.adapter._on_call_state(self, ci),
                    self.adapter._loop
                )
            except Exception as e:
                logger.exception("Erreur dans onCallState callback: %s", e)

    def _disconnect_conference_bridge(self, call_id: int) -> None:
        """Disconnect the conference bridge if it is still active."""

        endpoint = getattr(self.adapter, "_ep", None)
        call_slot = self._call_slot_id
        custom_slot = self._custom_port_slot_id

        def _disconnect_slots(src: int | None, dst: int | None) -> bool:
            if (
                endpoint is None
                or not hasattr(endpoint, "confDisconnect")
                or src is None
                or dst is None
            ):
                return False

            try:
                endpoint.confDisconnect(src, dst)  # type: ignore[attr-defined]
                logger.debug(
                    "✅ confDisconnect(%s → %s) exécuté (call_id=%s)", src, dst, call_id
                )
                return True
            except Exception as error:
                if not _is_invalid_conference_disconnect_error(error):
                    logger.warning(
                        "Erreur confDisconnect %s→%s (call_id=%s): %s",
                        src,
                        dst,
                        call_id,
                        error,
                    )
                return False

        slots_disconnected = False
        slots_disconnected |= _disconnect_slots(call_slot, custom_slot)
        slots_disconnected |= _disconnect_slots(custom_slot, call_slot)

        if not self._conference_connected:
            logger.debug(
                "Conference bridge déjà déconnecté (call_id=%s) — aucun stopTransmit nécessaire",
                call_id,
            )
        elif self._audio_port is not None and self._audio_media is not None:
            try:
                self._audio_media.stopTransmit(self._audio_port)
                logger.debug("✅ Déconnexion call → port réussie (call_id=%s)", call_id)
            except Exception as error:
                if not _is_invalid_conference_disconnect_error(error):
                    logger.warning(
                        "Erreur stopTransmit call→port (call_id=%s): %s",
                        call_id,
                        error,
                    )

            try:
                self._audio_port.stopTransmit(self._audio_media)
                logger.debug("✅ Déconnexion port → call réussie (call_id=%s)", call_id)
            except Exception as error:
                if not _is_invalid_conference_disconnect_error(error):
                    logger.warning(
                        "Erreur stopTransmit port→call (call_id=%s): %s",
                        call_id,
                        error,
                    )

        if slots_disconnected or self._conference_connected:
            logger.info("✅ Conference bridge déconnecté (call_id=%s)", call_id)

        # CRITIQUE: Retirer le port custom du bridge conference
        # Après confDisconnect, il faut aussi confRemovePort pour libérer complètement la ressource
        if endpoint is not None and hasattr(endpoint, "confRemovePort") and custom_slot is not None:
            try:
                endpoint.confRemovePort(custom_slot)  # type: ignore[attr-defined]
                logger.debug("✅ confRemovePort(slot=%s) exécuté (call_id=%s)", custom_slot, call_id)
            except Exception as error:
                # EINVAL peut arriver si le port est déjà retiré, c'est ok
                if not _is_invalid_conference_disconnect_error(error):
                    logger.warning("Erreur confRemovePort slot=%s (call_id=%s): %s", custom_slot, call_id, error)

        self._conference_connected = False
        self._audio_media = None
        self._call_slot_id = None
        self._custom_port_slot_id = None

    def onCallMediaState(self, prm: Any) -> None:
        """Appelé lors d'un changement d'état média."""
        if not PJSUA_AVAILABLE:
            return

        ci = self.getInfo()

        logger.info("🎵 onCallMediaState appelé pour call_id=%s, state=%s", ci.id, ci.state)

        # Vérifier si le média est actif
        media_is_active = False
        if ci.media:
            logger.info("📊 Nombre de médias: %d", len(ci.media))
            for mi in ci.media:
                if mi.type == pj.PJMEDIA_TYPE_AUDIO and mi.status == pj.PJSUA_CALL_MEDIA_ACTIVE:
                    media_is_active = True
                    self._media_active = True
                    logger.info("✅ Média audio actif pour call_id=%s, index=%d", ci.id, mi.index)

                    # Créer et connecter le port audio personnalisé
                    # IMPORTANT: Toujours recréer le port car PJSUA peut détruire et recréer
                    # le stream audio lors des UPDATE SIP (changement de codec)
                    if self._audio_port is not None:
                        logger.info(
                            "🔄 Port audio existe déjà, déconnexion conference bridge avant recréation (call_id=%s)",
                            ci.id,
                        )
                        try:
                            self._disconnect_conference_bridge(ci.id)
                        except Exception as e:
                            logger.warning("Erreur désactivation ancien port: %s", e)
                        finally:
                            old_port = self._audio_port
                            self._audio_port = None
                            if old_port is not None:
                                self.adapter.release_audio_port(old_port)

                    self._conference_connected = False

                    # Passer le bridge si disponible pour activer le mode PULL
                    bridge = getattr(self, '_audio_bridge', None)
                    self._audio_port = self.adapter.acquire_audio_port(
                        self._frame_requested_event,
                        call_id=ci.id,
                        audio_bridge=bridge,
                    )

                    if bridge:
                        logger.info("✅ Bridge connecté à AudioMediaPort (mode PULL activé)")

                    # Obtenir le média audio de l'appel
                    call_media = self.getMedia(mi.index)
                    audio_media = pj.AudioMedia.typecastFromMedia(call_media)

                    # Sauvegarder la référence pour pouvoir déconnecter plus tard
                    self._audio_media = audio_media

                    # CRITIQUE: Avec null sound device, le conference mixer n'est PAS automatiquement armé
                    # Il faut EXPLICITEMENT connecter les slots de conférence pour activer le traitement audio

                    # Log des slots de conférence AVANT connexion
                    try:
                        call_port_info = audio_media.getPortInfo()
                        custom_port_info = self._audio_port.getPortInfo()
                        self._call_slot_id = getattr(call_port_info, "portId", None)
                        self._custom_port_slot_id = getattr(
                            custom_port_info, "portId", None
                        )
                        logger.info("🔍 Slots de conférence AVANT connexion:")
                        logger.info("   - Call audio slot: %d (name=%s)", call_port_info.portId, call_port_info.name)
                        logger.info("   - Custom port slot: %d (name=%s)", custom_port_info.portId, custom_port_info.name)
                    except Exception as e:
                        logger.warning("⚠️ Impossible de lire les infos de port: %s", e)
                        self._call_slot_id = None
                        self._custom_port_slot_id = None

                    # Connecter : téléphone -> notre port (pour recevoir/capturer l'audio)
                    # Ceci active onFrameReceived() sur notre port
                    try:
                        audio_media.startTransmit(self._audio_port)
                        logger.info(
                            "✅ Connexion conference bridge: call (slot %d) → custom port (slot %d)",
                            call_port_info.portId if 'call_port_info' in locals() else -1,
                            custom_port_info.portId if 'custom_port_info' in locals() else -1,
                        )

                        # Connecter : notre port -> téléphone (pour envoyer/lecture l'audio)
                        # Ceci permet à onFrameRequested() d'envoyer l'audio au téléphone
                        self._audio_port.startTransmit(audio_media)
                        logger.info(
                            "✅ Connexion conference bridge: custom port (slot %d) → call (slot %d)",
                            custom_port_info.portId if 'custom_port_info' in locals() else -1,
                            call_port_info.portId if 'call_port_info' in locals() else -1,
                        )
                        self._conference_connected = True
                    except Exception as exc:
                        self._conference_connected = False
                        logger.warning("Erreur lors de la connexion du conference bridge: %s", exc)
                        raise

                    # Vérifier que les connexions sont établies au niveau du conference bridge
                    # Avec null sound device, c'est CRITIQUE - sinon on obtient du silence
                    try:
                        # Récupérer les infos après connexion pour vérifier
                        call_port_info_after = audio_media.getPortInfo()
                        custom_port_info_after = self._audio_port.getPortInfo()
                        self._call_slot_id = getattr(call_port_info_after, "portId", None)
                        self._custom_port_slot_id = getattr(
                            custom_port_info_after, "portId", None
                        )
                        logger.info("🎵 Connexions conference bridge établies (call_id=%s):", ci.id)
                        logger.info("   - Call audio: slot=%d, name=%s",
                                   call_port_info_after.portId, call_port_info_after.name)
                        logger.info("   - Custom port: slot=%d, name=%s",
                                   custom_port_info_after.portId, custom_port_info_after.name)

                        # 📊 DIAGNOSTIC: Trouver le VRAI port RTP local via psutil (infaillible)
                        logger.warning("🔍 Recherche du port RTP local via psutil (call_id=%s)...", ci.id)

                        try:
                            import os
                            import re

                            # Récupérer le port distant depuis StreamInfo
                            stream_info = self.getStreamInfo(mi.index)
                            remote_rtp = None
                            remote_ip = None
                            remote_port = None

                            if hasattr(stream_info, 'remoteRtpAddress'):
                                remote_rtp = stream_info.remoteRtpAddress
                                logger.warning("🔌 PORT RTP DISTANT: %s", remote_rtp)

                                # Parser IP:port
                                match = re.match(r'(.+):(\d+)$', remote_rtp)
                                if match:
                                    remote_ip = match.group(1)
                                    remote_port = int(match.group(2))

                            # Utiliser psutil pour trouver la socket RTP locale
                            # Les sockets UDP PJSUA ne sont pas "connectées" donc pas de raddr
                            # On cherche les sockets qui écoutent sur le range RTP (10000-20000)
                            try:
                                import psutil

                                # Obtenir le processus actuel
                                current_process = psutil.Process(os.getpid())

                                # DEBUG: Lister TOUTES les sockets UDP pour voir ce qui se passe
                                all_udp = []
                                for conn in current_process.connections(kind='udp'):
                                    all_udp.append(conn.laddr.port)

                                logger.warning("📋 DEBUG: Toutes les sockets UDP du processus (%d): %s",
                                             len(all_udp), sorted(all_udp))

                                # Lister toutes les sockets UDP du processus dans le range RTP
                                rtp_sockets = []
                                for conn in current_process.connections(kind='udp'):
                                    local_port = conn.laddr.port
                                    # Range RTP: 10000-20000 (pairs pour RTP, impairs pour RTCP)
                                    if 10000 <= local_port <= 20000:
                                        rtp_sockets.append((local_port, conn))

                                if rtp_sockets:
                                    # Trier par port (ordre d'allocation)
                                    rtp_sockets.sort(key=lambda x: x[0])

                                    # Filtrer uniquement les ports RTP (pairs)
                                    rtp_only = [p for p, _ in rtp_sockets if p % 2 == 0]

                                    if rtp_only:
                                        actual_port = rtp_only[-1]  # Le plus récent
                                        logger.warning("🔌 PORT RTP LOCAL (réel via psutil): 0.0.0.0:%d", actual_port)
                                        logger.warning("   Sockets RTP actives dans range: %s", rtp_only)
                                    else:
                                        logger.warning("⚠️ Aucun socket RTP pair trouvé dans range 10000-20000")
                                        logger.warning("   Sockets trouvées dans range: %s", [p for p, _ in rtp_sockets])
                                else:
                                    logger.warning("⚠️ Aucune socket UDP dans le range 10000-20000")
                                    logger.warning("   Peut-être que PJSUA utilise un range différent?")

                            except ImportError:
                                logger.warning("⚠️ psutil non disponible - impossible de trouver le port local")
                            except Exception as psutil_err:
                                logger.warning("⚠️ Erreur psutil: %s", psutil_err)
                                import traceback
                                logger.warning("Traceback: %s", traceback.format_exc())

                        except Exception as port_err:
                            logger.warning("⚠️ Erreur recherche port RTP: %s", port_err)
                            import traceback
                            logger.warning("Traceback: %s", traceback.format_exc())

                        logger.info("✅ Null sound device + conference bridge correctement armé")
                    except Exception as e:
                        logger.warning("⚠️ Impossible de vérifier les connexions conference bridge: %s", e)

                    # Notifier l'adaptateur que le média est prêt
                    if hasattr(self.adapter, '_on_media_active'):
                        try:
                            asyncio.run_coroutine_threadsafe(
                                self.adapter._on_media_active(self, mi),
                                self.adapter._loop
                            )
                        except Exception as e:
                            logger.exception("Erreur dans onCallMediaState callback: %s", e)

        # IMPORTANT: Si le média n'est plus actif et qu'on a un port audio, le désactiver
        # Cela évite les "ports zombies" qui continuent d'envoyer du silence après la fin de l'appel
        if not media_is_active and self._audio_port is not None:
            logger.warning("⚠️ Média désactivé mais port audio encore actif (call_id=%s) - nettoyage", ci.id)
            try:
                self._disconnect_conference_bridge(ci.id)
                port = self._audio_port
                self._audio_port = None
                if port is not None:
                    self.adapter.release_audio_port(port)
                logger.info("✅ Port audio zombie désactivé (call_id=%s)", ci.id)
            except Exception as e:
                # DEBUG si erreur post-mortem 171140, WARNING sinon
                if _is_session_terminated_error(e):
                    logger.debug("Erreur attendue désactivation port audio zombie (call_id=%s, déjà terminé): %s", ci.id, e)
                else:
                    logger.warning("Erreur désactivation port audio zombie (call_id=%s): %s", ci.id, e)
            finally:
                if self._audio_port is None:
                    self._conference_connected = False


class PJSUAAdapter:
    """Adaptateur principal pour PJSUA."""

    def __init__(self):
        if not PJSUA_AVAILABLE:
            raise RuntimeError(
                "pjsua2 n'est pas disponible. Installez-le avec: pip install pjsua2"
            )

        self._ep: pj.Endpoint | None = None
        self._transport: pj.TransportConfig | None = None
        self._account: PJSUAAccount | None = None
        self._active_calls: dict[int, PJSUACall] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._running = False
        self._audio_port_pool: list[AudioMediaPort] = []

        # Callbacks
        self._incoming_call_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None
        self._call_state_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None
        self._media_active_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None

        # Warning throttling pour éviter le spam de logs
        self._send_audio_warning_count = 0  # Compteur de warnings supprimés
        self._send_audio_last_warning = 0.0  # Timestamp du dernier warning loggé

    async def initialize(
        self,
        config: PJSUAConfig | None = None,
        *,
        port: int = 5060,
        nomadic_mode: bool = False
    ) -> None:
        """Initialise l'endpoint PJSUA et optionnellement crée le compte SIP.

        Args:
            config: Configuration SIP (optionnelle). Si None, seul l'endpoint est créé.
            port: Port UDP pour le transport SIP (utilisé si config est None)
            nomadic_mode: True = mode nomade (ICE activé), False = mode passerelle (ICE désactivé)
        """
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        self._loop = asyncio.get_running_loop()

        # Créer l'endpoint PJSUA
        self._ep = pj.Endpoint()
        self._ep.libCreate()

        # Configuration de l'endpoint
        ep_cfg = pj.EpConfig()
        # Niveau 1 = ERROR only (ne pas afficher les warnings "already terminated")
        # Ces "erreurs" sont normales quand on raccroche un appel déjà terminé
        ep_cfg.logConfig.level = 1  # ERROR level only
        ep_cfg.logConfig.consoleLevel = 1

        # Configuration du jitter buffer pour éviter l'accumulation de latence
        # CRITICAL: Sans cette config, le JB peut gonfler jusqu'à 200 frames (4 secondes!)
        # causant un lag progressif aux appels 2, 3, 4...
        # NOUVELLE CONFIG: réduire l'inertie du JB avec ptime fixe 20ms
        media_cfg = ep_cfg.medConfig
        media_cfg.jb_init = 1          # Démarrer à 1 frame (20ms) - rapide
        media_cfg.jb_min_pre = 1       # Minimum 1 frame en précharge
        media_cfg.jb_max_pre = 4       # Maximum 4 frames (80ms) en prefetch - réduit inertie
        media_cfg.jb_max = 10          # Maximum 10 frames (200ms) absolu
        media_cfg.snd_auto_close_time = 0  # Ne jamais fermer automatiquement le device

        # OPTIMISATION RTP: Large range pour éviter collisions de ports avec "dangling calls" du PBX
        # Le PBX peut continuer d'envoyer du RTP sur un ancien port pendant quelques secondes après raccrochage
        # Un range large (10000 ports) garantit qu'on ne réutilise pas le même port trop rapidement
        media_cfg.rtp_port = 10000      # Port de départ pour RTP
        media_cfg.rtp_port_range = 10000 # Large range: 10000-20000 pour éviter réutilisation rapide

        # OPTIMISATION: ICE selon le mode
        # Mode passerelle (défaut): ICE désactivé - pas besoin de négociation NAT sur serveur
        # Mode nomade: ICE activé - nécessaire pour traverser les NAT en mobilité
        media_cfg.enable_ice = nomadic_mode

        # OPTIMISATION: Activer RTCP mux pour multiplexer RTP+RTCP sur même port
        # Réduit l'utilisation de ports et simplifie le firewall
        media_cfg.enable_rtcp_mux = True

        # OPTIMISATION CRITIQUE: Désactiver VAD (Voice Activity Detection)
        # On fait du pontage audio vers OpenAI - ne pas couper l'audio sur les silences!
        media_cfg.no_vad = True

        logger.info(
            "📊 Jitter buffer configuré: init=%dms, min_pre=%dms, max_pre=%dms, max=%dms, auto_close=%d",
            media_cfg.jb_init * 20,
            media_cfg.jb_min_pre * 20,
            media_cfg.jb_max_pre * 20,
            media_cfg.jb_max * 20,
            media_cfg.snd_auto_close_time,
        )
        logger.info(
            "🔧 RTP configuré: port=%d, range=%d (ports %d-%d)",
            media_cfg.rtp_port,
            media_cfg.rtp_port_range,
            media_cfg.rtp_port,
            media_cfg.rtp_port + media_cfg.rtp_port_range,
        )
        logger.info(
            "🔧 Optimisations audio: mode=%s, ICE=%s, RTCP_mux=%s, VAD=%s",
            "nomade" if nomadic_mode else "passerelle",
            "enabled" if media_cfg.enable_ice else "disabled",
            "enabled" if media_cfg.enable_rtcp_mux else "disabled",
            "disabled" if media_cfg.no_vad else "enabled",
        )

        # Initialiser l'endpoint
        self._ep.libInit(ep_cfg)

        # Configure null audio device (no hardware required)
        # This is essential for Docker environments without sound cards
        self._ep.audDevManager().setNullDev()
        logger.info("PJSUA configured to use null audio device (no hardware)")

        # Créer le transport UDP
        transport_cfg = pj.TransportConfig()
        transport_cfg.port = port if config is None else config.port
        self._transport = self._ep.transportCreate(pj.PJSIP_TRANSPORT_UDP, transport_cfg)

        # Démarrer l'endpoint
        self._ep.libStart()

        logger.info(
            "PJSUA endpoint démarré sur UDP:%d",
            port if config is None else config.port,
        )

        # Créer le compte SIP si configuré
        if config is not None and config.register:
            await self._create_account(config)

        self._running = True

    async def _create_account(self, config: PJSUAConfig) -> None:
        """Crée et enregistre un compte SIP."""
        if not self._ep:
            raise RuntimeError("Endpoint PJSUA non initialisé")

        # Configuration du compte
        acc_cfg = pj.AccountConfig()
        acc_cfg.idUri = config.sip_uri
        acc_cfg.regConfig.registrarUri = config.registrar_uri

        # Authentification
        cred = pj.AuthCredInfo()
        cred.scheme = "digest"
        cred.realm = "*"
        cred.username = config.username
        cred.dataType = 0  # plain text password
        cred.data = config.password
        acc_cfg.sipConfig.authCreds.append(cred)

        # Créer le compte
        self._account = PJSUAAccount(self)
        self._account.create(acc_cfg)

        logger.info(
            "Compte SIP créé: %s",
            config.sip_uri,
        )

    async def load_account_from_db(self, session: Any) -> bool:
        """Charge le compte SIP par défaut depuis la base de données.

        Args:
            session: Session SQLAlchemy pour accéder à la BD

        Returns:
            True si un compte a été chargé, False sinon
        """
        from sqlalchemy import select  # noqa: I001
        from ..models import SipAccount

        # Récupérer le compte SIP par défaut et actif
        account = session.scalar(
            select(SipAccount)
            .where(
                SipAccount.is_active.is_(True),
                SipAccount.is_default.is_(True),
            )
            .order_by(SipAccount.id.asc())
        )

        if not account:
            # Sinon, prendre le premier compte actif
            account = session.scalar(
                select(SipAccount)
                .where(SipAccount.is_active.is_(True))
                .order_by(SipAccount.id.asc())
            )

        if not account:
            logger.warning("Aucun compte SIP actif trouvé dans la base de données")
            return False

        logger.info(
            "Chargement du compte SIP: %s (ID: %d)",
            account.label,
            account.id,
        )

        # Construire la configuration PJSUA
        config = PJSUAConfig(
            sip_uri=account.trunk_uri,
            registrar_uri=account.trunk_uri,  # Utiliser trunk_uri comme registrar
            username=account.username or "",
            password=account.password or "",
            port=account.contact_port or 5060,
            transport="UDP",  # TODO: supporter TCP/TLS
            register=True,
        )

        # Créer le compte
        await self._create_account(config)

        return True

    async def shutdown(self) -> None:
        """Arrête proprement PJSUA."""
        self._running = False

        # Terminer tous les appels actifs avec nettoyage complet
        call_ids = list(self._active_calls.keys())
        logger.info("Arrêt de %d appel(s) actif(s)", len(call_ids))

        for call_id in call_ids:
            try:
                # Utiliser cleanup_call pour un nettoyage complet
                await self.cleanup_call(call_id)
            except Exception as e:
                logger.exception("Erreur lors du nettoyage de l'appel %s: %s", call_id, e)

        self._drain_audio_port_pool()

        # Détruire le compte
        if self._account:
            try:
                self._account.shutdown()
            except Exception as e:
                logger.exception("Erreur lors de la fermeture du compte: %s", e)

        # Détruire l'endpoint
        if self._ep:
            try:
                self._ep.libDestroy()
            except Exception as e:
                logger.exception("Erreur lors de la destruction de l'endpoint: %s", e)

        logger.info("PJSUA arrêté")

    def set_incoming_call_callback(
        self, callback: Callable[[PJSUACall, Any], Awaitable[None]]
    ) -> None:
        """Définit le callback pour les appels entrants."""
        self._incoming_call_callback = callback

    def set_call_state_callback(
        self, callback: Callable[[PJSUACall, Any], Awaitable[None]]
    ) -> None:
        """Définit le callback pour les changements d'état d'appel."""
        self._call_state_callback = callback

    def set_media_active_callback(
        self, callback: Callable[[PJSUACall, Any], Awaitable[None]]
    ) -> None:
        """Définit le callback pour l'activation du média."""
        self._media_active_callback = callback

    async def _on_reg_state(self, is_active: bool) -> None:
        """Callback interne pour les changements d'état d'enregistrement."""
        logger.info("État enregistrement SIP: %s", "actif" if is_active else "inactif")

    async def _on_incoming_call(self, call: PJSUACall, call_info: Any) -> None:
        """Callback interne pour les appels entrants."""
        # Sécurité: vérifier qu'on n'écrase pas un appel actif
        # Cela ne devrait jamais arriver si le cleanup est correct
        if call_info.id in self._active_calls:
            existing_call = self._active_calls[call_info.id]
            if existing_call != call:
                logger.error(
                    "⚠️ SÉCURITÉ: call_id=%d existe déjà dans _active_calls! "
                    "Possible réutilisation d'ID sans cleanup complet. "
                    "Forçage du cleanup de l'ancien appel...",
                    call_info.id,
                )

                # CRITIQUE: Nettoyer complètement l'ancien appel AVANT de le remplacer
                try:
                    # Forcer le cleanup immédiat sans délai
                    old_call = existing_call

                    # Marquer comme terminé
                    old_call._terminated = True
                    old_call._closed = True
                    old_call._cleanup_done = True

                    # Arrêter l'audio bridge
                    if hasattr(old_call, '_audio_bridge') and old_call._audio_bridge:
                        old_call._audio_bridge.stop()
                        old_call._audio_bridge = None

                    # Nettoyer le port audio
                    if old_call._audio_port:
                        port = old_call._audio_port
                        old_call._audio_port = None
                        try:
                            old_call._disconnect_conference_bridge(call_info.id)
                        except:
                            pass
                        self.release_audio_port(port)

                    # Hangup si nécessaire
                    try:
                        await self.hangup_call(old_call)
                    except:
                        pass

                    # Détruire l'objet
                    del old_call

                    logger.warning("✅ Ancien appel call_id=%d nettoyé et détruit", call_info.id)

                except Exception as cleanup_err:
                    logger.error("⚠️ Erreur cleanup forcé ancien appel: %s", cleanup_err)

        self._active_calls[call_info.id] = call

        if self._incoming_call_callback:
            await self._incoming_call_callback(call, call_info)

    async def _on_call_state(self, call: PJSUACall, call_info: Any) -> None:
        """Callback interne pour les changements d'état d'appel.

        Note: Ce callback est appelé quand PJSUA signale un changement d'état.
        Pour DISCONNECTED, on fait un nettoyage immédiat sans délai car PJSUA
        a déjà terminé son propre nettoyage interne.
        """
        # Nettoyer les appels terminés
        if call_info.state == pj.PJSIP_INV_STATE_DISCONNECTED:
            # CRITIQUE: Marquer terminated=True IMMÉDIATEMENT pour empêcher tout hangup/getInfo ultérieur
            # Doit être fait AVANT le check _cleanup_done pour garantir le flag même si cleanup skip
            call._terminated = True

            # Protection idempotente: éviter les doubles nettoyages
            if call._cleanup_done:
                logger.debug("Nettoyage déjà effectué pour call_id=%s, ignoré", call_info.id)
                return

            call._cleanup_done = True
            logger.info("📞 Appel DISCONNECTED détecté - nettoyage immédiat (call_id=%s)", call_info.id)

            self._active_calls.pop(call_info.id, None)

            # IMPORTANT: Arrêter l'audio bridge d'abord pour stopper le RTP stream
            if hasattr(call, '_audio_bridge') and call._audio_bridge:
                try:
                    logger.info("🛑 Arrêt de l'audio bridge (call_id=%s)", call_info.id)
                    call._audio_bridge.stop()
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue arrêt audio bridge (call_id=%s, déjà terminé): %s", call_info.id, e)
                    else:
                        logger.warning("Erreur arrêt audio bridge (call_id=%s): %s", call_info.id, e)
                finally:
                    call._audio_bridge = None

            # IMPORTANT: Nettoyer le port audio pour éviter les fuites
            # PJSUA continue d'appeler onFrameRequested si on ne déconnecte pas
            if call._audio_port:
                port = call._audio_port
                call._audio_port = None
                try:
                    call._disconnect_conference_bridge(call_info.id)
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue désactivation port audio (call_id=%s, déjà terminé): %s", call_info.id, e)
                    else:
                        logger.warning("Erreur désactivation port audio (call_id=%s): %s", call_info.id, e)
                finally:
                    self.release_audio_port(port)
                    logger.info("✅ Port audio désactivé (call_id=%s)", call_info.id)

        if self._call_state_callback:
            await self._call_state_callback(call, call_info)

    async def _on_media_active(self, call: PJSUACall, media_info: Any) -> None:
        """Callback interne pour l'activation du média."""
        if self._media_active_callback:
            await self._media_active_callback(call, media_info)

    async def answer_call(self, call: PJSUACall, code: int = 200) -> None:
        """Répond à un appel entrant."""
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        # Préparer les paramètres de réponse
        prm = pj.CallOpParam()
        prm.statusCode = code

        # Répondre à l'appel
        call.answer(prm)
        logger.info("Réponse envoyée à l'appel (code=%d)", code)

    async def hangup_call(self, call: PJSUACall) -> None:
        """Termine un appel de manière idempotente.

        Vérifie le flag _terminated avant de tenter hangup().
        Cela évite les appels inutiles à hangup() sur des sessions déjà terminées.
        """
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        # Protection: vérifier si l'appel est déjà terminé AVANT tout appel PJSUA
        if call._terminated or call._closed:
            logger.debug("hangup_call skipped: already terminated=%s or closed=%s", call._terminated, call._closed)
            return

        try:
            prm = pj.CallOpParam()
            call.hangup(prm)
            logger.info("Appel terminé via hangup()")
        except Exception as e:
            # PJSIP_ESESSIONTERMINATED (171140) signifie "déjà terminé" - c'est ok
            error_str = str(e).lower()
            if "already terminated" in error_str or "esessionterminated" in error_str or "171140" in str(e):
                logger.debug("Appel déjà terminé (171140), traité comme succès")
            else:
                # Autre erreur réelle
                raise

    async def cleanup_call(self, call_id: int) -> None:
        """Nettoie proprement une session d'appel PJSUA.

        Attend un délai avant de nettoyer pour laisser PJSUA terminer proprement,
        puis nettoie les ressources audio et raccroche l'appel si nécessaire.

        Args:
            call_id: ID de l'appel à nettoyer
        """
        try:
            # Attendre un peu avant de nettoyer pour laisser PJSUA terminer
            await asyncio.sleep(0.5)

            # Récupérer l'appel depuis active_calls
            call = self._active_calls.get(call_id)
            if not call:
                logger.debug("Appel %s déjà nettoyé ou introuvable", call_id)
                return

            # Protection idempotente: éviter les doubles nettoyages (race avec DISCONNECTED callback)
            if call._closed or call._cleanup_done:
                logger.debug(
                    "Nettoyage déjà effectué pour call_id=%s (closed=%s, cleanup_done=%s), ignoré",
                    call_id,
                    call._closed,
                    call._cleanup_done,
                )
                return

            # Marquer l'appel comme fermé IMMÉDIATEMENT pour empêcher tout accès concurrent
            call._closed = True
            call._cleanup_done = True
            logger.info("🧹 Début nettoyage appel (call_id=%s, terminated=%s)", call_id, call._terminated)

            # Arrêter l'audio bridge d'abord (si attaché dynamiquement à l'appel)
            if hasattr(call, '_audio_bridge') and call._audio_bridge:
                try:
                    logger.info("🛑 Arrêt de l'audio bridge (call_id=%s)", call_id)
                    call._audio_bridge.stop()
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue arrêt audio bridge (call_id=%s, déjà terminé): %s", call_id, e)
                    else:
                        logger.warning("Erreur arrêt audio bridge (call_id=%s): %s", call_id, e)
                finally:
                    call._audio_bridge = None

            # Désactiver le port audio
            if call._audio_port:
                port = call._audio_port
                call._audio_port = None
                try:
                    call._disconnect_conference_bridge(call_id)
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue désactivation port audio (call_id=%s, déjà terminé): %s", call_id, e)
                    else:
                        logger.warning("Erreur désactivation port audio (call_id=%s): %s", call_id, e)
                finally:
                    self.release_audio_port(port)
                    logger.info("🛑 Désactivation du port audio (call_id=%s)", call_id)

            # Vérifier l'état avant de hangup
            if call and self._is_call_valid(call):
                try:
                    logger.info("📞 Hangup de l'appel (call_id=%s)", call_id)
                    await self.hangup_call(call)
                except Exception as e:
                    # DEBUG si erreur post-mortem 171140, WARNING sinon
                    if _is_session_terminated_error(e):
                        logger.debug("Erreur attendue hangup (call_id=%s, déjà terminé): %s", call_id, e)
                    else:
                        logger.warning("Erreur hangup (call_id=%s): %s", call_id, e)

            # Retirer de active_calls
            self._active_calls.pop(call_id, None)

            # CRITIQUE: Destruction explicite de l'objet Call pour libérer les ressources PJSUA
            # Sans cela, PJSUA peut garder des références internes et ne pas libérer les ports RTP
            try:
                # Marquer l'objet comme invalide
                call._terminated = True
                call._closed = True

                # Forcer la destruction de l'objet Call
                # Note: Python garbage collectera l'objet, mais on s'assure qu'il n'y a plus de refs
                del call
                logger.info("✅ Nettoyage terminé + Call object détruit (call_id=%s)", call_id)
            except Exception as del_err:
                logger.warning("⚠️ Erreur destruction Call object (call_id=%s): %s", call_id, del_err)

        except Exception as e:
            # DEBUG si erreur post-mortem 171140, WARNING sinon
            if _is_session_terminated_error(e):
                logger.debug("Erreur attendue cleanup (call_id=%s, déjà terminé): %s", call_id, e)
            else:
                logger.warning("Erreur cleanup (call_id=%s): %s", call_id, e)

    def _is_call_valid(self, call: PJSUACall) -> bool:
        """Vérifie si un appel est toujours valide et peut être raccroché.

        Utilise les flags _terminated/_closed au lieu de getInfo() pour éviter
        les appels PJSUA post-mortem qui génèrent des erreurs 171140.

        Args:
            call: L'appel PJSUA à vérifier

        Returns:
            True si l'appel est valide et peut être raccroché, False sinon
        """
        if not PJSUA_AVAILABLE or not call:
            return False

        # Vérifier les flags d'état au lieu d'appeler getInfo()
        # Cela évite les erreurs ESESSIONTERMINATED (171140) post-mortem
        return not (call._terminated or call._closed)

    async def make_call(self, dest_uri: str) -> PJSUACall:
        """Initie un appel sortant."""
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        if not self._account:
            raise RuntimeError("Aucun compte SIP configuré")

        # Créer un nouvel appel
        call = PJSUACall(self)

        # Préparer les paramètres d'appel
        prm = pj.CallOpParam()
        prm.opt.audioCount = 1
        prm.opt.videoCount = 0

        # Passer l'appel
        call.makeCall(dest_uri, prm)

        # Récupérer l'info de l'appel pour obtenir l'ID
        ci = call.getInfo()

        # Sécurité: vérifier qu'on n'écrase pas un appel actif
        # Cela ne devrait jamais arriver si le cleanup est correct
        if ci.id in self._active_calls:
            existing_call = self._active_calls[ci.id]
            if existing_call != call:
                logger.error(
                    "⚠️ SÉCURITÉ: call_id=%d existe déjà dans _active_calls! "
                    "Possible réutilisation d'ID sans cleanup complet. "
                    "Ancien appel sera remplacé.",
                    ci.id,
                )

        self._active_calls[ci.id] = call

        logger.info("Appel sortant initié vers %s", dest_uri)
        return call

    def get_call_info(self, call: PJSUACall) -> CallInfo:
        """Récupère les informations d'un appel."""
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        ci = call.getInfo()
        return CallInfo(
            call_id=ci.id,
            remote_uri=ci.remoteUri,
            state=str(ci.state),
            state_text=ci.stateText,
            local_contact=ci.localContact,
            remote_contact=ci.remoteContact,
            has_media=bool(ci.media),
        )

    # ===== Méthodes Audio =====

    def send_audio_to_call(self, call: PJSUACall, audio_data: bytes) -> None:
        """Envoie de l'audio vers un appel (PCM 8kHz, 16-bit, mono)."""
        if call._audio_port:
            call._audio_port.send_audio(audio_data)
        else:
            # Throttling: log seulement toutes les 2 secondes max
            import time
            now = time.monotonic()
            if now - self._send_audio_last_warning >= 2.0:
                if self._send_audio_warning_count > 0:
                    logger.warning(
                        "Tentative d'envoi audio sur un appel sans port audio (%d suppressed)",
                        self._send_audio_warning_count
                    )
                    self._send_audio_warning_count = 0
                else:
                    logger.warning("Tentative d'envoi audio sur un appel sans port audio")
                self._send_audio_last_warning = now
            else:
                self._send_audio_warning_count += 1

    async def receive_audio_from_call(self, call: PJSUACall) -> bytes | None:
        """Récupère l'audio reçu d'un appel (PCM 8kHz, 16-bit, mono)."""
        if call._audio_port:
            return await call._audio_port.get_audio()
        return None

    def clear_call_audio_queue(self, call: PJSUACall) -> int:
        """Vide la queue audio sortante d'un appel (utilisé lors d'interruptions).

        Returns:
            Nombre de frames vidées
        """
        if call._audio_port:
            return call._audio_port.clear_outgoing_audio_queue()
        return 0

    def clear_call_incoming_audio_queue(self, call: PJSUACall) -> int:
        """Vide la queue audio entrante d'un appel (utilisé pour supprimer le silence initial).

        Returns:
            Nombre de frames vidées
        """
        if call._audio_port:
            return call._audio_port.clear_incoming_audio_queue()
        return 0

    def acquire_audio_port(
        self,
        frame_requested_event: asyncio.Event | None,
        *,
        call_id: int | None = None,
        audio_bridge: Any | None = None,
    ) -> AudioMediaPort:
        """Retourne un port audio prêt pour un nouvel appel.

        COOLDOWN: Force recreate après N réutilisations pour casser tout état latent.
        Si MAX_REUSE_COUNT = 0, réutilisation illimitée sans jamais détruire le port.
        """
        # Port reuse is now SAFE thanks to active drain in prepare_for_pool()
        # Active drain eliminates race condition with residual PJSUA jitter buffer frames
        # Allow many reuses before forced recreation (performance optimization)
        MAX_REUSE_COUNT = 20  # Recreate every 20 uses as preventive maintenance

        if self._audio_port_pool:
            port = self._audio_port_pool.pop()

            # SAFETY CHECK: Verify port is clean (should never fail with active drain)
            incoming_size = port._incoming_audio_queue.qsize()
            outgoing_size = port._outgoing_audio_queue.qsize()

            if incoming_size > 0 or outgoing_size > 0:
                logger.error(
                    "⚠️ SAFETY: Port from pool is DIRTY! incoming=%d, outgoing=%d "
                    "(active drain should have prevented this - possible bug!)",
                    incoming_size, outgoing_size
                )
                # Force clean before use
                try:
                    while True:
                        port._incoming_audio_queue.get_nowait()
                except queue.Empty:
                    pass
                try:
                    while True:
                        port._outgoing_audio_queue.get_nowait()
                except queue.Empty:
                    pass
                logger.info("🗑️ Emergency cleanup: queues forcibly drained")

            # Vérifier le compteur de réutilisation (0 = illimité)
            if MAX_REUSE_COUNT > 0 and port._reuse_count >= MAX_REUSE_COUNT:
                logger.info(
                    "🔄 Port atteint %d réutilisations - destruction et recréation (call_id=%s)",
                    port._reuse_count, call_id
                )
                try:
                    port.deactivate(destroy_port=True)
                except Exception as exc:
                    logger.debug("Erreur destruction port (cooldown): %s", exc)

                # Créer un nouveau port après cooldown
                logger.info(
                    "🔧 Création d'un nouvel AudioMediaPort après cooldown (call_id=%s)",
                    call_id
                )
                new_port = AudioMediaPort(self, frame_requested_event, audio_bridge)

                # 📊 Diagnostic: Enregistrer que le port a été recréé
                if audio_bridge and hasattr(audio_bridge, '_chatkit_call_id') and audio_bridge._chatkit_call_id:
                    from .call_diagnostics import get_diagnostics_manager
                    diag_manager = get_diagnostics_manager()
                    diag = diag_manager.get_call(audio_bridge._chatkit_call_id)
                    if diag:
                        diag.port_reuse_count = 0
                        diag.port_recreated = True

                return new_port

            # Réutiliser le port existant
            port._reuse_count += 1
            logger.info(
                "♻️ Réutilisation d'un AudioMediaPort depuis le pool (reuse #%d, call_id=%s)",
                port._reuse_count, call_id
            )
            port.prepare_for_new_call(frame_requested_event, audio_bridge)

            # 📊 Diagnostic: Enregistrer le nombre de réutilisations
            if audio_bridge and hasattr(audio_bridge, '_chatkit_call_id') and audio_bridge._chatkit_call_id:
                from .call_diagnostics import get_diagnostics_manager
                diag_manager = get_diagnostics_manager()
                diag = diag_manager.get_call(audio_bridge._chatkit_call_id)
                if diag:
                    diag.port_reuse_count = port._reuse_count
                    diag.port_recreated = False

            return port

        logger.info(
            "🔧 Création d'un nouvel AudioMediaPort (call_id=%s)",
            call_id
        )
        new_port = AudioMediaPort(self, frame_requested_event, audio_bridge)

        # 📊 Diagnostic: Premier port créé (pool vide)
        if audio_bridge and hasattr(audio_bridge, '_chatkit_call_id') and audio_bridge._chatkit_call_id:
            from .call_diagnostics import get_diagnostics_manager
            diag_manager = get_diagnostics_manager()
            diag = diag_manager.get_call(audio_bridge._chatkit_call_id)
            if diag:
                diag.port_reuse_count = 0
                diag.port_recreated = False

        return new_port

    def release_audio_port(
        self, port: AudioMediaPort, *, destroy: bool = False
    ) -> None:
        """Remet le port dans le pool ou le détruit définitivement."""

        try:
            if destroy:
                port.deactivate(destroy_port=True)
            else:
                port.prepare_for_pool()
        except Exception as exc:  # pragma: no cover - nettoyage défensif
            logger.debug("Erreur lors du recyclage du port audio: %s", exc)
            destroy = True

        if not destroy:
            self._audio_port_pool.append(port)

    def _drain_audio_port_pool(self) -> None:
        """Détruit tous les ports présents dans le pool (arrêt complet)."""

        while self._audio_port_pool:
            port = self._audio_port_pool.pop()
            try:
                port.deactivate(destroy_port=True)
            except Exception as exc:  # pragma: no cover - nettoyage défensif
                logger.debug("Erreur destruction port audio du pool: %s", exc)

    def set_audio_callback(
        self, callback: Callable[[bytes], Awaitable[None]]
    ) -> None:
        """Définit un callback appelé quand de l'audio est reçu."""
        self._audio_callback = callback

    async def _on_audio_received(self, audio_data: bytes) -> None:
        """Callback interne appelé quand de l'audio est reçu."""
        if hasattr(self, '_audio_callback') and self._audio_callback:
            try:
                await self._audio_callback(audio_data)
            except Exception as e:
                logger.exception("Erreur dans audio callback: %s", e)


# Instance globale
_pjsua_adapter: PJSUAAdapter | None = None


def get_pjsua_adapter() -> PJSUAAdapter:
    """Retourne l'instance globale de l'adaptateur PJSUA."""
    global _pjsua_adapter
    if _pjsua_adapter is None:
        _pjsua_adapter = PJSUAAdapter()
    return _pjsua_adapter
