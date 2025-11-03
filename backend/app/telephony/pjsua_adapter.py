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
import struct
import threading
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("chatkit.telephony.pjsua")
logger.setLevel(logging.WARNING)  # Réduire la verbosité des logs SIP

# Import conditionnel de pjsua2
PJSUA_AVAILABLE = False
try:
    import pjsua2 as pj
    PJSUA_AVAILABLE = True
    logger.info("PJSUA2 chargé avec succès")
except ImportError as e:
    logger.warning("pjsua2 n'est pas disponible: %s", e)
    pj = None  # type: ignore


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
    """Port audio personnalisé pour capturer et injecter l'audio."""

    def __init__(self, adapter: PJSUAAdapter):
        if not PJSUA_AVAILABLE:
            return

        # Configuration du port audio
        # PJSUA utilise 8kHz, 16-bit, mono pour la téléphonie
        self.adapter = adapter
        self.sample_rate = 8000
        self.channels = 1
        self.samples_per_frame = 160  # 20ms @ 8kHz
        self.bits_per_sample = 16

        # Files pour l'audio
        # Buffer de 1000 frames = 20 secondes @ 20ms/frame
        # Grande capacité nécessaire:
        # - OpenAI envoie en très gros bursts (plusieurs centaines de ms d'audio d'un coup)
        # - PJSUA consomme à taux fixe (20ms/frame)
        # - Queue absorbe les bursts sans perdre de paquets
        # - Préférer latence plutôt que perte audio (coupures audibles)
        # - Tests montrent que 1000 frames évite les "⚠️ Queue audio sortante pleine"
        self._incoming_audio_queue = queue.Queue(maxsize=100)  # Du téléphone
        self._outgoing_audio_queue = queue.Queue(maxsize=1000)  # Vers le téléphone - 20s max

        # Compteurs pour diagnostics
        self._frame_count = 0
        self._audio_frame_count = 0
        self._silence_frame_count = 0

        # Flag pour arrêter le traitement après la déconnexion de l'appel
        self._active = True

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
        if self._frame_count == 1 and self.adapter._frame_requested_event and not self.adapter._frame_requested_event.is_set():
            logger.info("🎬 Premier onFrameRequested - PJSUA est prêt à consommer l'audio")
            self.adapter._frame_requested_event.set()

        expected_size = self.samples_per_frame * 2  # 320 bytes pour 160 samples @ 16-bit

        try:
            # Récupérer l'audio de la queue (non-bloquant)
            audio_data = self._outgoing_audio_queue.get_nowait()
            self._audio_frame_count += 1

            # Vérifier si c'est vraiment de l'audio (pas du silence)
            is_silence = all(b == 0 for b in audio_data[:min(20, len(audio_data))])

            if self._audio_frame_count <= 5 or (self._audio_frame_count <= 20 and not is_silence):
                logger.info("📢 onFrameRequested #%d: audio trouvé (%d bytes) - %s",
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
                logger.debug("🔇 onFrameRequested #%d: queue vide, envoi silence (total silence: %d)",
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
                # Récupérer l'audio PCM déjà décodé par PJSUA
                audio_pcm = bytes(frame.buf[:frame.size])

                # DIAGNOSTIC: Vérifier si c'est du silence ou du vrai audio
                # Avec conference bridge mal connecté, on recevra du silence (tous les bytes = 0)
                max_amplitude = audioop.max(audio_pcm, 2) if len(audio_pcm) > 0 else 0
                is_silence = max_amplitude == 0

                if self._frame_received_count <= 5:
                    logger.info("✅ Audio PCM extrait: %d bytes, premiers bytes: %s, max_amplitude=%d %s",
                               len(audio_pcm), list(audio_pcm[:10]) if len(audio_pcm) >= 10 else list(audio_pcm),
                               max_amplitude, "⚠️ SILENCE!" if is_silence else "✅ AUDIO VALIDE")

                # Si on reçoit que du silence pendant les premières frames, c'est un problème
                if self._frame_received_count <= 20 and is_silence:
                    logger.warning("⚠️ Frame #%d contient du SILENCE (conference bridge peut-être mal connecté)",
                                 self._frame_received_count)

                # Ajouter l'audio PCM à la queue pour traitement async
                self._incoming_audio_queue.put_nowait(audio_pcm)

                if self._frame_received_count <= 5:
                    logger.info("✅ Audio ajouté à la queue (taille queue: %d)", self._incoming_audio_queue.qsize())

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

    def deactivate(self) -> None:
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
            logger.info("🗑️  Queues audio vidées: %d frames entrantes, %d frames sortantes",
                       incoming_cleared, outgoing_cleared)


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
                        logger.info("🔄 Port audio existe déjà, destruction avant recréation (call_id=%s)", ci.id)
                        try:
                            self._audio_port.deactivate()
                        except Exception as e:
                            logger.warning("Erreur désactivation ancien port: %s", e)

                    logger.info("🔧 Création du AudioMediaPort pour call_id=%s", ci.id)
                    self._audio_port = AudioMediaPort(self.adapter)

                    # Obtenir le média audio de l'appel
                    call_media = self.getMedia(mi.index)
                    audio_media = pj.AudioMedia.typecastFromMedia(call_media)

                    # CRITIQUE: Avec null sound device, le conference mixer n'est PAS automatiquement armé
                    # Il faut EXPLICITEMENT connecter les slots de conférence pour activer le traitement audio

                    # Log des slots de conférence AVANT connexion
                    try:
                        call_port_info = audio_media.getPortInfo()
                        custom_port_info = self._audio_port.getPortInfo()
                        logger.info("🔍 Slots de conférence AVANT connexion:")
                        logger.info("   - Call audio slot: %d (name=%s)", call_port_info.portId, call_port_info.name)
                        logger.info("   - Custom port slot: %d (name=%s)", custom_port_info.portId, custom_port_info.name)
                    except Exception as e:
                        logger.warning("⚠️ Impossible de lire les infos de port: %s", e)

                    # Connecter : téléphone -> notre port (pour recevoir/capturer l'audio)
                    # Ceci active onFrameReceived() sur notre port
                    audio_media.startTransmit(self._audio_port)
                    logger.info("✅ Connexion conference bridge: call (slot %d) → custom port (slot %d)",
                               call_port_info.portId if 'call_port_info' in locals() else -1,
                               custom_port_info.portId if 'custom_port_info' in locals() else -1)

                    # Connecter : notre port -> téléphone (pour envoyer/lecture l'audio)
                    # Ceci permet à onFrameRequested() d'envoyer l'audio au téléphone
                    self._audio_port.startTransmit(audio_media)
                    logger.info("✅ Connexion conference bridge: custom port (slot %d) → call (slot %d)",
                               custom_port_info.portId if 'custom_port_info' in locals() else -1,
                               call_port_info.portId if 'call_port_info' in locals() else -1)

                    # Vérifier que les connexions sont établies au niveau du conference bridge
                    # Avec null sound device, c'est CRITIQUE - sinon on obtient du silence
                    try:
                        # Récupérer les infos après connexion pour vérifier
                        call_port_info_after = audio_media.getPortInfo()
                        custom_port_info_after = self._audio_port.getPortInfo()
                        logger.info("🎵 Connexions conference bridge établies (call_id=%s):", ci.id)
                        logger.info("   - Call audio: slot=%d, name=%s",
                                   call_port_info_after.portId, call_port_info_after.name)
                        logger.info("   - Custom port: slot=%d, name=%s",
                                   custom_port_info_after.portId, custom_port_info_after.name)
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
                self._audio_port.deactivate()
                logger.info("✅ Port audio zombie désactivé (call_id=%s)", ci.id)
            except Exception as e:
                logger.warning("Erreur désactivation port audio zombie: %s", e)
            finally:
                # Ne pas mettre à None ici car _on_call_state le fera
                # self._audio_port = None
                pass


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

        # Event qui se déclenche quand PJSUA commence à consommer l'audio (onFrameRequested appelé)
        self._frame_requested_event: asyncio.Event | None = None

        # Callbacks globaux (legacy)
        self._incoming_call_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None
        self._call_state_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None
        self._media_active_callback: Callable[[PJSUACall, Any], Awaitable[None]] | None = None

        # Callbacks par call_id (pour éviter l'accumulation entre appels rapprochés)
        self._call_state_callbacks: dict[int, Callable[[PJSUACall, Any], Awaitable[None]]] = {}
        self._media_active_callbacks: dict[int, Callable[[PJSUACall, Any], Awaitable[None]]] = {}

    async def initialize(self, config: PJSUAConfig | None = None, *, port: int = 5060) -> None:
        """Initialise l'endpoint PJSUA et optionnellement crée le compte SIP.

        Args:
            config: Configuration SIP (optionnelle). Si None, seul l'endpoint est créé.
            port: Port UDP pour le transport SIP (utilisé si config est None)
        """
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        self._loop = asyncio.get_running_loop()
        self._frame_requested_event = asyncio.Event()

        # Créer l'endpoint PJSUA
        self._ep = pj.Endpoint()
        self._ep.libCreate()

        # Configuration de l'endpoint
        ep_cfg = pj.EpConfig()
        # Niveau 1 = ERROR only (ne pas afficher les warnings "already terminated")
        # Ces "erreurs" sont normales quand on raccroche un appel déjà terminé
        ep_cfg.logConfig.level = 1  # ERROR level only
        ep_cfg.logConfig.consoleLevel = 1

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
        from sqlalchemy import select
        from ..models import SipAccount

        # Récupérer le compte SIP par défaut et actif
        account = session.scalar(
            select(SipAccount)
            .where(SipAccount.is_active == True, SipAccount.is_default == True)
            .order_by(SipAccount.id.asc())
        )

        if not account:
            # Sinon, prendre le premier compte actif
            account = session.scalar(
                select(SipAccount)
                .where(SipAccount.is_active == True)
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
        """Définit le callback pour l'activation du média (legacy - utiliser register_call_*_callback à la place)."""
        self._media_active_callback = callback

    def register_call_state_callback(
        self, call_id: int, callback: Callable[[PJSUACall, Any], Awaitable[None]]
    ) -> None:
        """Enregistre un callback pour les changements d'état d'un appel spécifique.

        Ce callback sera automatiquement retiré quand l'appel se termine (DISCONNECTED).
        Utiliser cette méthode au lieu de set_call_state_callback pour éviter l'accumulation
        de callbacks entre appels rapprochés.
        """
        self._call_state_callbacks[call_id] = callback
        logger.debug("📞 Callback d'état enregistré pour call_id=%s", call_id)

    def unregister_call_state_callback(self, call_id: int) -> None:
        """Retire le callback d'état pour un appel spécifique."""
        self._call_state_callbacks.pop(call_id, None)
        logger.debug("📞 Callback d'état retiré pour call_id=%s", call_id)

    def register_media_active_callback(
        self, call_id: int, callback: Callable[[PJSUACall, Any], Awaitable[None]]
    ) -> None:
        """Enregistre un callback pour l'activation du média d'un appel spécifique.

        Ce callback sera automatiquement retiré quand l'appel se termine (DISCONNECTED).
        Utiliser cette méthode au lieu de set_media_active_callback pour éviter l'accumulation
        de callbacks entre appels rapprochés.
        """
        self._media_active_callbacks[call_id] = callback
        logger.debug("🎵 Callback média enregistré pour call_id=%s", call_id)

    def unregister_media_active_callback(self, call_id: int) -> None:
        """Retire le callback média pour un appel spécifique."""
        self._media_active_callbacks.pop(call_id, None)
        logger.debug("🎵 Callback média retiré pour call_id=%s", call_id)

    async def _on_reg_state(self, is_active: bool) -> None:
        """Callback interne pour les changements d'état d'enregistrement."""
        logger.info("État enregistrement SIP: %s", "actif" if is_active else "inactif")

    async def _on_incoming_call(self, call: PJSUACall, call_info: Any) -> None:
        """Callback interne pour les appels entrants."""
        self._active_calls[call_info.id] = call

        if self._incoming_call_callback:
            await self._incoming_call_callback(call, call_info)

    async def _on_call_state(self, call: PJSUACall, call_info: Any) -> None:
        """Callback interne pour les changements d'état d'appel.

        Note: Ce callback est appelé quand PJSUA signale un changement d'état.
        Pour DISCONNECTED, on fait un nettoyage immédiat sans délai car PJSUA
        a déjà terminé son propre nettoyage interne.
        """
        # Appeler le callback spécifique à cet appel EN PREMIER
        # (avant le nettoyage pour permettre au callback de faire son propre cleanup)
        call_specific_callback = self._call_state_callbacks.get(call_info.id)
        if call_specific_callback:
            try:
                await call_specific_callback(call, call_info)
            except Exception as e:
                logger.exception("Erreur dans callback d'état spécifique (call_id=%s): %s", call_info.id, e)

        # Nettoyer les appels terminés
        if call_info.state == pj.PJSIP_INV_STATE_DISCONNECTED:
            logger.info("📞 Appel DISCONNECTED détecté - nettoyage immédiat (call_id=%s)", call_info.id)

            self._active_calls.pop(call_info.id, None)

            # IMPORTANT: Nettoyer les callbacks pour cet appel (éviter accumulation)
            self._call_state_callbacks.pop(call_info.id, None)
            self._media_active_callbacks.pop(call_info.id, None)
            logger.debug("🧹 Callbacks nettoyés pour call_id=%s", call_info.id)

            # IMPORTANT: Arrêter l'audio bridge d'abord pour stopper le RTP stream
            if hasattr(call, '_audio_bridge') and call._audio_bridge:
                try:
                    logger.info("🛑 Arrêt de l'audio bridge (call_id=%s)", call_info.id)
                    call._audio_bridge.stop()
                except Exception as e:
                    logger.warning("Erreur arrêt audio bridge (call_id=%s): %s", call_info.id, e)
                finally:
                    call._audio_bridge = None

            # IMPORTANT: Nettoyer le port audio pour éviter les fuites
            # PJSUA continue d'appeler onFrameRequested si on ne déconnecte pas
            if call._audio_port:
                try:
                    # Désactiver le port pour arrêter le traitement des frames
                    # Cela empêche l'envoi continu de silence après la fin de l'appel
                    call._audio_port.deactivate()
                    logger.info("✅ Port audio désactivé (call_id=%s)", call_info.id)

                    # Note: stopTransmit() nécessiterait l'audio_media comme argument
                    # et de toute façon le port sera détruit, donc pas nécessaire
                except Exception as e:
                    logger.warning("Erreur désactivation port audio (call_id=%s): %s", call_info.id, e)
                finally:
                    call._audio_port = None

        # Appeler le callback global (legacy) si défini
        if self._call_state_callback:
            try:
                await self._call_state_callback(call, call_info)
            except Exception as e:
                logger.exception("Erreur dans callback d'état global: %s", e)

    async def _on_media_active(self, call: PJSUACall, media_info: Any) -> None:
        """Callback interne pour l'activation du média."""
        # Obtenir le call_id pour le callback spécifique
        try:
            call_info = call.getInfo()
            call_id = call_info.id
        except Exception:
            call_id = None

        # Appeler le callback spécifique à cet appel EN PREMIER
        if call_id is not None:
            call_specific_callback = self._media_active_callbacks.get(call_id)
            if call_specific_callback:
                try:
                    await call_specific_callback(call, media_info)
                except Exception as e:
                    logger.exception("Erreur dans callback média spécifique (call_id=%s): %s", call_id, e)

        # Appeler le callback global (legacy) si défini
        if self._media_active_callback:
            try:
                await self._media_active_callback(call, media_info)
            except Exception as e:
                logger.exception("Erreur dans callback média global: %s", e)

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
        """Termine un appel."""
        if not PJSUA_AVAILABLE:
            raise RuntimeError("pjsua2 n'est pas disponible")

        # Vérifier si l'appel est déjà terminé pour éviter les erreurs "INVITE session already terminated"
        try:
            ci = call.getInfo()
            if ci.state == pj.PJSIP_INV_STATE_DISCONNECTED:
                logger.debug("Appel déjà terminé (call_id=%s), ignorer hangup", ci.id)
                return
        except Exception as e:
            # Si getInfo() échoue avec "already terminated", l'appel est déjà terminé
            error_str = str(e).lower()
            if "already terminated" in error_str or "esessionterminated" in error_str:
                logger.debug("Appel déjà terminé (getInfo échoué), ignorer hangup: %s", e)
                return
            # Sinon, logger l'erreur mais continuer pour essayer le hangup
            logger.debug("Impossible de vérifier l'état de l'appel: %s", e)

        try:
            prm = pj.CallOpParam()
            call.hangup(prm)
            logger.info("Appel terminé")
        except Exception as e:
            # Ignorer les erreurs si l'appel est déjà terminé
            error_str = str(e).lower()
            if "already terminated" in error_str or "esessionterminated" in error_str:
                logger.debug("Appel déjà terminé, erreur ignorée: %s", e)
            else:
                # Réemettre l'exception si c'est une autre erreur
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

            logger.info("🧹 Début nettoyage appel (call_id=%s)", call_id)

            # Arrêter l'audio bridge d'abord (si attaché dynamiquement à l'appel)
            if hasattr(call, '_audio_bridge') and call._audio_bridge:
                try:
                    logger.info("🛑 Arrêt de l'audio bridge (call_id=%s)", call_id)
                    call._audio_bridge.stop()
                except Exception as e:
                    logger.warning("Erreur arrêt audio bridge (call_id=%s): %s", call_id, e)
                finally:
                    call._audio_bridge = None

            # Désactiver le port audio
            if call._audio_port:
                try:
                    logger.info("🛑 Désactivation du port audio (call_id=%s)", call_id)
                    call._audio_port.deactivate()
                except Exception as e:
                    logger.warning("Erreur désactivation port audio (call_id=%s): %s", call_id, e)
                finally:
                    call._audio_port = None

            # Vérifier l'état avant de hangup
            if call and self._is_call_valid(call):
                try:
                    logger.info("📞 Hangup de l'appel (call_id=%s)", call_id)
                    await self.hangup_call(call)
                except Exception as e:
                    logger.warning("Erreur hangup (call_id=%s): %s", call_id, e)

            # Retirer de active_calls
            self._active_calls.pop(call_id, None)
            logger.info("✅ Nettoyage terminé (call_id=%s)", call_id)

        except Exception as e:
            logger.warning("Erreur cleanup (call_id=%s): %s", call_id, e)

    def _is_call_valid(self, call: PJSUACall) -> bool:
        """Vérifie si un appel est toujours valide et peut être raccroché.

        Args:
            call: L'appel PJSUA à vérifier

        Returns:
            True si l'appel est valide et peut être raccroché, False sinon
        """
        if not PJSUA_AVAILABLE or not call:
            return False

        try:
            ci = call.getInfo()
            # Vérifier si l'appel n'est pas déjà terminé
            return ci.state != pj.PJSIP_INV_STATE_DISCONNECTED
        except Exception:
            # Si getInfo() échoue, l'appel n'est pas valide
            return False

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
            logger.warning("Tentative d'envoi audio sur un appel sans port audio")

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
