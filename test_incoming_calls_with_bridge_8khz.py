#!/home/fpoisson/.pyenv/versions/pjsip311/bin/python
"""Test des appels entrants avec intégration du Voice Bridge à 8kHz.

Ce script teste l'envoi de audio à 8kHz DIRECTEMENT à OpenAI sans upsampling à 24kHz.
Ceci permet de tester si OpenAI peut accepter des fréquences d'échantillonnage plus basses
que 24kHz, ce qui pourrait réduire la latence et la bande passante.

Usage:
    python test_incoming_calls_with_bridge_8khz.py --sip-uri sip:user@domain.com --username user --password pass
"""

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path
from collections.abc import AsyncIterator

# Ajouter le répertoire backend au path
ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Configuration du logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("test_incoming_8khz")

# IMPORTANT: Définir les variables d'environnement requises AVANT d'importer backend
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("AUTH_SECRET_KEY", "test-secret-key-for-incoming-calls")
os.environ.setdefault("CELERY_BROKER_URL", "redis://localhost:6379/0")

# Importer les modules du projet
try:
    from backend.app.telephony.pjsua_adapter import (
        PJSUAAdapter,
        PJSUAConfig,
        PJSUA_AVAILABLE
    )
    from backend.app.telephony.voice_bridge import (
        TelephonyVoiceBridge,
        VoiceBridgeHooks,
        VoiceBridgeMetricsRecorder,
        RtpPacket,
    )
    from agents.realtime.agent import RealtimeAgent
    from agents.realtime.runner import RealtimeRunner

    if not PJSUA_AVAILABLE:
        logger.error("❌ PJSUA2 n'est pas disponible")
        sys.exit(1)

    logger.info("✅ Modules du projet chargés avec succès")
except ImportError as e:
    logger.error("❌ Erreur lors de l'import des modules: %s", e)
    logger.error("Assurez-vous que les dépendances sont installées")
    import traceback
    traceback.print_exc()
    sys.exit(1)


async def create_pjsua_audio_bridge_8khz(call, media_active_event=None):
    """Crée un audio bridge qui envoie directement à 8kHz (pas d'upsampling).

    Cette fonction est une variante de create_pjsua_audio_bridge qui:
    1. Ne fait PAS d'upsampling de 8kHz vers 24kHz
    2. Envoie les paquets RTP directement à 8kHz vers OpenAI
    3. Continue à downsampler de 24kHz vers 8kHz pour le retour (OpenAI → téléphone)

    Args:
        call: L'appel PJSUA
        media_active_event: Event optionnel pour attendre que le média soit actif

    Returns:
        Tuple (rtp_stream, send_to_peer, clear_queue, first_packet_event,
               pjsua_ready_event, bridge_mock)
    """
    from backend.app.telephony.pjsua_audio_bridge import PJSUAAudioBridge

    # Créer le bridge normal
    bridge = PJSUAAudioBridge(call)
    call._audio_bridge = bridge

    # Event pour le premier paquet
    first_packet_event = asyncio.Event()

    # Event pour PJSUA ready
    pjsua_ready_event = call._frame_requested_event

    # RTP stream qui envoie à 8kHz directement (pas d'upsampling)
    async def rtp_stream_8khz() -> AsyncIterator[RtpPacket]:
        """Génère des paquets RTP à 8kHz directement (PAS d'upsampling)."""
        if media_active_event is not None:
            logger.info("⏳ RTP stream 8kHz: attente que le média soit actif...")
            await media_active_event.wait()
            logger.info("✅ RTP stream 8kHz: média actif, démarrage")

        logger.info("🎵 RTP stream 8kHz: démarrage (SANS upsampling)")

        packet_count = 0
        sequence_number = 0
        timestamp = 0

        try:
            while not bridge._stop_event.is_set():
                # Récupérer audio depuis PJSUA (8kHz PCM16 mono)
                audio_8khz = await call.adapter.receive_audio_from_call(call)

                if audio_8khz is None:
                    await asyncio.sleep(0.01)
                    continue

                if len(audio_8khz) == 0:
                    continue

                # Signaler le premier paquet
                if packet_count == 0:
                    logger.info("📥 Premier paquet audio 8kHz reçu (taille=%d bytes)", len(audio_8khz))
                    first_packet_event.set()

                # Log périodique
                if packet_count < 5 or packet_count % 500 == 0:
                    logger.debug("📥 RTP 8kHz #%d: %d bytes", packet_count, len(audio_8khz))

                # Créer paquet RTP à 8kHz (PAS de conversion!)
                # IMPORTANT: On envoie directement à 8kHz
                packet = RtpPacket(
                    payload=audio_8khz,
                    timestamp=timestamp,
                    sequence_number=sequence_number,
                    payload_type=0,
                    marker=False,
                )

                # À 8kHz: 20ms = 160 samples
                # Incrément du timestamp = 160 samples par paquet
                timestamp += 160
                sequence_number = (sequence_number + 1) % 65536
                packet_count += 1

                yield packet

        except asyncio.CancelledError:
            logger.info("🛑 RTP stream 8kHz cancelled")
            raise
        except Exception as e:
            logger.exception("❌ Erreur dans RTP stream 8kHz: %s", e)
            raise
        finally:
            logger.info("🛑 RTP stream 8kHz terminé (%d paquets)", packet_count)

    # send_to_peer reste le même (downsampling 24kHz → 8kHz)
    send_to_peer = bridge.send_to_peer

    # clear_queue reste le même
    def clear_queue() -> int:
        return call.adapter.clear_call_incoming_audio_queue(call)

    logger.info("✅ Audio bridge 8kHz créé (SANS upsampling)")

    return (
        rtp_stream_8khz(),
        send_to_peer,
        clear_queue,
        first_packet_event,
        pjsua_ready_event,
        bridge,
    )


class IncomingCallTester8kHz:
    """Testeur d'appels entrants avec voice bridge à 8kHz."""

    def __init__(
        self,
        sip_config: PJSUAConfig,
        model: str = "gpt-4o-realtime-preview",
        voice: str = "alloy",
        instructions: str = "Vous êtes un assistant vocal de test à 8kHz. Répondez brièvement.",
        api_key: str | None = None,
    ):
        self.sip_config = sip_config
        self.model = model
        self.voice = voice
        self.instructions = instructions
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")

        if not self.api_key:
            raise ValueError("OPENAI_API_KEY doit être défini")

        self.adapter: PJSUAAdapter | None = None
        self.voice_bridge: TelephonyVoiceBridge | None = None
        self.metrics = VoiceBridgeMetricsRecorder()
        self.active_calls = {}
        self.running = False

    async def initialize(self):
        """Initialise l'adaptateur PJSUA et le voice bridge."""
        logger.info("🚀 Initialisation du testeur 8kHz...")

        hooks = VoiceBridgeHooks(
            close_dialog=self._on_close_dialog,
            clear_voice_state=self._on_clear_voice_state,
            resume_workflow=self._on_resume_workflow,
        )

        # CHANGEMENT CLÉ: Configurer pour 8kHz au lieu de 24kHz
        logger.info("🎵 Configuration du voice bridge pour 8kHz DIRECT (pas d'upsampling)")
        self.voice_bridge = TelephonyVoiceBridge(
            hooks=hooks,
            metrics=self.metrics,
            input_codec="pcm",  # Audio en PCM16
            target_sample_rate=8000,  # 🎯 8kHz au lieu de 24kHz!
        )
        logger.info("✅ Voice bridge configuré pour 8kHz")

        # Créer l'adaptateur PJSUA
        self.adapter = PJSUAAdapter()
        self.adapter.set_incoming_call_callback(self._on_incoming_call)
        await self.adapter.initialize(config=self.sip_config)
        logger.info("✅ Adaptateur PJSUA initialisé")

    async def _on_incoming_call(self, call, call_info):
        """Gestionnaire d'appel entrant."""
        call_id = call_info.id
        logger.info("📞 ===== APPEL ENTRANT 8KHZ =====")
        logger.info("📞 De: %s", call_info.remoteUri)
        logger.info("📞 Call ID: %s", call_id)

        try:
            # Créer un audio bridge 8kHz (sans upsampling)
            logger.info("🎵 Création du bridge audio 8kHz...")
            media_active = asyncio.Event()

            (
                rtp_stream,
                send_to_peer,
                clear_queue,
                first_packet_event,
                pjsua_ready_event,
                audio_bridge,
            ) = await create_pjsua_audio_bridge_8khz(call, media_active)

            logger.info("✅ Bridge audio 8kHz créé")

            # Accepter l'appel
            logger.info("✅ Acceptation de l'appel...")
            await self.adapter.answer_call(call)

            # Signaler que le média est actif
            media_active.set()

            # Attendre que le média soit actif
            await asyncio.sleep(1)

            # Démarrer le voice bridge
            logger.info("🎵 Démarrage du voice bridge 8kHz...")
            asyncio.create_task(
                self._run_voice_bridge(
                    call,
                    rtp_stream,
                    send_to_peer,
                    clear_queue,
                    pjsua_ready_event,
                    audio_bridge,
                )
            )

            # Sauvegarder l'appel actif
            self.active_calls[call_id] = {
                "call": call,
                "call_info": call_info,
                "audio_bridge": audio_bridge,
            }

        except Exception as e:
            logger.error("❌ Erreur lors du traitement de l'appel: %s", e)
            import traceback
            traceback.print_exc()

    async def _run_voice_bridge(
        self,
        call,
        rtp_stream,
        send_to_peer,
        clear_queue,
        pjsua_ready_event,
        audio_bridge,
    ):
        """Exécute le voice bridge pour un appel."""
        call_info = call.getInfo()
        call_id = call_info.id

        try:
            logger.info("🎵 Voice bridge 8kHz démarré pour l'appel %s", call_id)

            # Attendre que PJSUA soit prêt
            await pjsua_ready_event.wait()
            logger.info("✅ PJSUA prêt à consommer l'audio")

            # Créer un nouveau runner pour chaque appel
            agent = RealtimeAgent(
                name=f"incoming-call-8khz-test-{call_id}",
                instructions=self.instructions
            )
            runner = RealtimeRunner(agent)
            logger.info("✅ Nouveau runner créé pour l'appel %s", call_id)

            # Exécuter le voice bridge avec configuration 8kHz
            logger.info("🎤 Exécution du voice bridge à 8kHz...")
            stats = await self.voice_bridge.run(
                runner=runner,
                client_secret=self.api_key,
                model=self.model,
                instructions=self.instructions,
                voice=self.voice,
                rtp_stream=rtp_stream,
                send_to_peer=send_to_peer,
                clear_audio_queue=clear_queue,
                pjsua_ready_to_consume=pjsua_ready_event,
                audio_bridge=audio_bridge,
            )

            logger.info("✅ Voice bridge 8kHz terminé pour l'appel %s", call_id)
            logger.info("   Durée: %.2f secondes", stats.duration_seconds)
            logger.info("   Audio entrant: %d bytes", stats.inbound_audio_bytes)
            logger.info("   Audio sortant: %d bytes", stats.outbound_audio_bytes)
            logger.info("   Transcriptions: %d", stats.transcript_count)

            if stats.error:
                logger.error("   ❌ Erreur: %s", stats.error)
            else:
                logger.info("   ✅ Test 8kHz réussi!")

        except Exception as e:
            logger.error("❌ Erreur dans le voice bridge 8kHz: %s", e)
            import traceback
            traceback.print_exc()
        finally:
            try:
                audio_bridge.stop()
                logger.info("✅ Bridge audio 8kHz arrêté")
            except Exception as e:
                logger.warning("Erreur lors de l'arrêt du bridge: %s", e)

            if call_id in self.active_calls:
                del self.active_calls[call_id]

    async def _on_close_dialog(self):
        """Hook appelé lors de la fermeture d'un dialogue."""
        logger.debug("Hook: close_dialog")

    async def _on_clear_voice_state(self):
        """Hook appelé pour nettoyer l'état vocal."""
        logger.debug("Hook: clear_voice_state")

    async def _on_resume_workflow(self, transcripts: list[dict[str, str]]):
        """Hook appelé pour reprendre le workflow."""
        logger.info("Hook: resume_workflow")
        logger.info("Transcriptions:")
        for t in transcripts:
            logger.info("  [%s] %s", t["role"], t["text"])

    async def run(self, duration: int = 0):
        """Exécute le testeur.

        Args:
            duration: Durée en secondes (0 = infini)
        """
        self.running = True
        logger.info("🎧 En attente d'appels entrants (mode 8kHz)...")
        logger.info("   (Appuyez sur Ctrl+C pour arrêter)")

        import time
        start_time = time.time()

        try:
            while self.running:
                await asyncio.sleep(0.5)

                if duration > 0 and (time.time() - start_time) >= duration:
                    logger.info("⏱️ Durée de test écoulée")
                    break

        except KeyboardInterrupt:
            logger.info("\n⚠️ Interruption par l'utilisateur")
        finally:
            await self.cleanup()

    async def cleanup(self):
        """Nettoie les ressources."""
        logger.info("🧹 Nettoyage...")

        self.running = False

        # Terminer tous les appels actifs
        for call_id, call_data in list(self.active_calls.items()):
            try:
                call = call_data["call"]
                await self.adapter.hangup_call(call)
            except Exception as e:
                logger.warning("Erreur lors de la fermeture de l'appel %s: %s", call_id, e)

        # Nettoyer l'adaptateur
        if self.adapter:
            await self.adapter.cleanup()

        logger.info("✅ Nettoyage terminé")

        # Afficher les statistiques
        logger.info("\n📊 Statistiques 8kHz:")
        snapshot = self.metrics.snapshot()
        for key, value in snapshot.items():
            logger.info("  %s: %s", key, value)


async def main():
    """Point d'entrée principal."""
    parser = argparse.ArgumentParser(
        description="Test des appels entrants avec Voice Bridge à 8kHz (pas d'upsampling)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  # Test basique 8kHz
  %(prog)s --sip-uri sip:test@sip.example.com --username test --password secret

  # Test avec modèle et voix personnalisés
  %(prog)s --sip-uri sip:test@sip.example.com --username test --password secret \\
           --model gpt-4o-realtime-preview --voice shimmer
        """
    )

    parser.add_argument(
        "--sip-uri",
        required=True,
        help="URI SIP du compte (ex: sip:user@domain.com)"
    )
    parser.add_argument(
        "--registrar-uri",
        help="URI du registrar SIP (ex: sip:domain.com)"
    )
    parser.add_argument(
        "--username",
        required=True,
        help="Nom d'utilisateur pour l'authentification"
    )
    parser.add_argument(
        "--password",
        required=True,
        help="Mot de passe pour l'authentification"
    )
    parser.add_argument(
        "--transport",
        default="UDP",
        choices=["UDP", "TCP"],
        help="Type de transport SIP (défaut: UDP)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=5060,
        help="Port d'écoute SIP (défaut: 5060)"
    )
    parser.add_argument(
        "--model",
        default="gpt-4o-realtime-preview",
        help="Modèle OpenAI à utiliser"
    )
    parser.add_argument(
        "--voice",
        default="alloy",
        choices=["alloy", "echo", "shimmer", "ash", "ballad", "coral", "sage", "verse"],
        help="Voix à utiliser (défaut: alloy)"
    )
    parser.add_argument(
        "--instructions",
        default="Vous êtes un assistant vocal de test à 8kHz. Répondez brièvement.",
        help="Instructions pour l'assistant"
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=0,
        help="Durée du test en secondes (0 = infini)"
    )
    parser.add_argument(
        "--api-key",
        help="Clé API OpenAI (défaut: OPENAI_API_KEY env var)"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Active le mode verbeux"
    )

    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Extraire le registrar de l'URI SIP
    registrar_uri = args.registrar_uri
    if not registrar_uri:
        if "@" in args.sip_uri:
            domain = args.sip_uri.split("@", 1)[1]
            registrar_uri = f"sip:{domain}"
        else:
            logger.error("❌ Impossible d'extraire le registrar de l'URI SIP")
            sys.exit(1)

    logger.info("=" * 60)
    logger.info("Test des appels entrants - Audio 8kHz DIRECT")
    logger.info("=" * 60)
    logger.info("🎯 CONFIGURATION: Envoi à 8kHz sans upsampling vers OpenAI")
    logger.info("SIP URI: %s", args.sip_uri)
    logger.info("Registrar: %s", registrar_uri)
    logger.info("Transport: %s sur port %d", args.transport, args.port)
    logger.info("Modèle: %s", args.model)
    logger.info("Voix: %s", args.voice)
    logger.info("=" * 60)

    # Créer la configuration SIP
    sip_config = PJSUAConfig(
        sip_uri=args.sip_uri,
        registrar_uri=registrar_uri,
        username=args.username,
        password=args.password,
        transport=args.transport,
        port=args.port,
    )

    # Créer et initialiser le testeur
    tester = IncomingCallTester8kHz(
        sip_config=sip_config,
        model=args.model,
        voice=args.voice,
        instructions=args.instructions,
        api_key=args.api_key,
    )

    try:
        await tester.initialize()
        await tester.run(duration=args.duration)
    except Exception as e:
        logger.error("❌ Erreur fatale: %s", e)
        import traceback
        traceback.print_exc()
        sys.exit(1)

    logger.info("👋 Test 8kHz terminé")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n⚠️ Interruption par l'utilisateur")
        sys.exit(0)
