"""Callbacks utilisés par l'adaptateur PJSUA."""
# ruff: noqa: E501

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any

from .async_helpers import schedule_coroutine_from_thread
from .call_diagnostics import CallDiagnostics
from .media import AudioMediaPort
from .pjsua_errors import (
    _is_invalid_conference_disconnect_error,
    _is_session_terminated_error,
)
from .pjsua_lib import PJSUA_AVAILABLE, logger, pj

if TYPE_CHECKING:
    from .pjsua_adapter import PJSUAAdapter


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
            schedule_coroutine_from_thread(
                self.adapter._on_reg_state(ai.regIsActive),
                self.adapter._loop,
                callback_name="onRegState",
                logger=logger,
            )

    def onIncomingCall(self, prm: Any) -> None:
        """Appelé lors d'un appel entrant."""
        if not PJSUA_AVAILABLE:
            return

        diagnostics = CallDiagnostics(call_id=str(prm.callId))
        call = PJSUACall(self.adapter, call_id=prm.callId, diagnostics=diagnostics)
        call_info = call.getInfo()

        logger.info(
            "Appel SIP entrant de %s",
            call_info.remoteUri,
        )

        # Notifier l'adaptateur de l'appel entrant
        if hasattr(self.adapter, '_on_incoming_call'):
            schedule_coroutine_from_thread(
                self.adapter._on_incoming_call(call, call_info),
                self.adapter._loop,
                callback_name="onIncomingCall",
                logger=logger,
            )


class PJSUACall(pj.Call if PJSUA_AVAILABLE else object):
    """Callback pour un appel PJSUA."""

    def __init__(
        self,
        adapter: PJSUAAdapter,
        call_id: int | None = None,
        acc: Any = None,
        diagnostics: CallDiagnostics | None = None,
    ):
        if PJSUA_AVAILABLE:
            if call_id is not None:
                super().__init__(acc or adapter._account, call_id)
            else:
                super().__init__(acc or adapter._account)
        self.adapter = adapter
        self._diagnostics: CallDiagnostics = diagnostics or CallDiagnostics(
            call_id=str(call_id) if call_id is not None else "pjsua-pending"
        )
        self._diagnostics.reset_cleanup_state()
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

    @property
    def diagnostics(self) -> CallDiagnostics:
        """Retourne l'objet de diagnostics associé à cet appel."""

        return self._diagnostics

    @property
    def chatkit_call_id(self) -> str | None:
        """Expose l'identifiant ChatKit via l'objet de diagnostics."""

        return self._diagnostics.chatkit_call_id

    @chatkit_call_id.setter
    def chatkit_call_id(self, value: str | None) -> None:
        self._diagnostics.set_chatkit_call_id(value)

    @property
    def _cleanup_done(self) -> bool:  # type: ignore[override]
        return self._diagnostics.cleanup_done

    @_cleanup_done.setter
    def _cleanup_done(self, value: bool) -> None:  # type: ignore[override]
        if value:
            self._diagnostics.mark_cleanup_done()
        else:
            self._diagnostics.cleanup_done = False

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
            schedule_coroutine_from_thread(
                self.adapter._on_call_state(self, ci),
                self.adapter._loop,
                callback_name="onCallState",
                logger=logger,
            )

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
        # CRITICAL FIX: Verify confRemovePort success to detect conference slot leaks
        remove_port_success = False
        if endpoint is not None and hasattr(endpoint, "confRemovePort") and custom_slot is not None:
            try:
                endpoint.confRemovePort(custom_slot)  # type: ignore[attr-defined]
                remove_port_success = True
                logger.debug("✅ confRemovePort(slot=%s) exécuté (call_id=%s)", custom_slot, call_id)
            except Exception as error:
                # EINVAL peut arriver si le port est déjà retiré, c'est ok
                if not _is_invalid_conference_disconnect_error(error):
                    logger.error("⚠️ CRITIQUE: confRemovePort ÉCHEC slot=%s (call_id=%s): %s - POSSIBLE FUITE DE SLOT CONFERENCE", custom_slot, call_id, error)
                else:
                    # Port déjà retiré = succès
                    remove_port_success = True
                    logger.debug("confRemovePort: port déjà retiré (EINVAL), considéré comme succès")

        # Log critical warning if confRemovePort failed (conference slot leak detected)
        if custom_slot is not None and not remove_port_success:
            logger.error("🚨 FUITE DE SLOT CONFERENCE DÉTECTÉE: slot=%s (call_id=%s) N'A PAS ÉTÉ LIBÉRÉ!", custom_slot, call_id)

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
                            import re

                            # Récupérer le port distant depuis StreamInfo
                            stream_info = self.getStreamInfo(mi.index)
                            remote_rtp = None
                            remote_ip = None
                            remote_port = None

                            # 🎵 DIAGNOSTIC: Codec et qualité audio
                            if hasattr(stream_info, 'codecName'):
                                logger.warning("🎵 CODEC NÉGOCIÉ: %s @ %d Hz",
                                             stream_info.codecName,
                                             getattr(stream_info, 'codecClockRate', 0))

                            # 📊 DIAGNOSTIC: Stats RTP (packet loss, jitter)
                            if hasattr(stream_info, 'rtpStat'):
                                rtp_stat = stream_info.rtpStat
                                logger.warning("📊 RTP STATS: loss=%d packets (%.1f%%), jitter_ms=%.1f, avg_burst=%d",
                                             getattr(rtp_stat, 'loss', 0),
                                             getattr(rtp_stat, 'lossPct', 0.0) / 65536.0,  # Fixed point to float
                                             getattr(rtp_stat, 'jitter', 0) / 16.0,  # Jitter en ms
                                             getattr(rtp_stat, 'avgBurst', 0))

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
                                current_process = psutil.Process()

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
                        schedule_coroutine_from_thread(
                            self.adapter._on_media_active(self, mi),
                            self.adapter._loop,
                            callback_name="onCallMediaState",
                            logger=logger,
                        )

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


__all__ = ["PJSUAAccount", "PJSUACall"]


