#!/home/fpoisson/.pyenv/versions/pjsip311/bin/python
"""Test des appels entrants avec intégration du Voice Bridge.

Ce script utilise les librairies du projet (pjsua_adapter, voice_bridge) pour
tester les appels entrants avec connexion à l'API Realtime.

Usage:
    python test_incoming_calls_with_bridge.py --sip-uri sip:user@domain.com --username user --password pass
"""

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

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
logger = logging.getLogger("test_incoming_with_bridge")

# IMPORTANT: Définir les variables d'environnement requises AVANT d'importer backend
# Ces valeurs par défaut permettent d'importer les modules sans erreur
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("AUTH_SECRET_KEY", "test-secret-key-for-incoming-calls")
os.environ.setdefault("CELERY_BROKER_URL", "redis://localhost:6379/0")
# OPENAI_API_KEY doit être défini avant l'import (via test_config.env ou en ligne de commande)
# Le backend valide cette clé à l'import, donc pas de placeholder possible

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
    )
    from backend.app.telephony.pjsua_audio_bridge import create_pjsua_audio_bridge
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


class IncomingCallTester:
    """Testeur d'appels entrants avec voice bridge."""

    def __init__(
        self,
        sip_config: PJSUAConfig,
        model: str = "gpt-4o-realtime-preview",
        voice: str = "alloy",
        instructions: str = "Vous êtes un assistant vocal de test. Répondez brièvement aux questions.",
        api_key: str | None = None,
    ):
        self.sip_config = sip_config
        self.model = model
        self.voice = voice
        self.instructions = instructions
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")

        if not self.api_key:
            raise ValueError("OPENAI_API_KEY doit être défini (variable d'env ou paramètre)")

        self.adapter: PJSUAAdapter | None = None
        self.voice_bridge: TelephonyVoiceBridge | None = None
        self.metrics = VoiceBridgeMetricsRecorder()
        self.active_calls = {}
        self.running = False

        # Créer le runner OpenAI
        self.runner = Runner(api_key=self.api_key)

    async def initialize(self):
        """Initialise l'adaptateur PJSUA et le voice bridge."""
        logger.info("🚀 Initialisation du testeur d'appels entrants...")

        # Créer les hooks pour le voice bridge
        hooks = VoiceBridgeHooks(
            close_dialog=self._on_close_dialog,
            clear_voice_state=self._on_clear_voice_state,
            resume_workflow=self._on_resume_workflow,
        )

        # Créer le voice bridge
        self.voice_bridge = TelephonyVoiceBridge(
            hooks=hooks,
            metrics=self.metrics,
        )

        # Créer l'adaptateur PJSUA
        self.adapter = PJSUAAdapter()

        # Définir le callback pour les appels entrants
        self.adapter.set_incoming_call_callback(self._on_incoming_call)

        # Initialiser l'adaptateur avec la configuration SIP
        await self.adapter.initialize(config=self.sip_config)
        logger.info("✅ Adaptateur PJSUA initialisé")

    async def _on_incoming_call(self, call, call_info):
        """Gestionnaire d'appel entrant."""
        call_id = call_info.id  # call_info est un objet pj.CallInfo de PJSUA
        logger.info("📞 ===== APPEL ENTRANT =====")
        logger.info("📞 De: %s", call_info.remoteUri)
        logger.info("📞 Call ID: %s", call_id)

        try:
            # Accepter l'appel
            logger.info("✅ Acceptation de l'appel...")
            await self.adapter.answer_call(call)

            # Attendre que le média soit actif
            await asyncio.sleep(1)

            # Créer un audio bridge pour cet appel avec la fonction helper
            logger.info("🎵 Création du bridge audio...")
            media_active = asyncio.Event()
            media_active.set()  # Déjà actif après answer_call

            (
                rtp_stream,
                send_to_peer,
                clear_queue,
                first_packet_event,
                pjsua_ready_event,
                audio_bridge,
            ) = await create_pjsua_audio_bridge(call, media_active)

            # Démarrer le voice bridge
            logger.info("🎵 Démarrage du voice bridge...")
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
        # Extraire le call_id depuis l'objet call
        call_info = call.getInfo()
        call_id = call_info.id

        try:
            logger.info("🎵 Voice bridge démarré pour l'appel %s", call_id)

            # Attendre que PJSUA soit prêt à consommer l'audio
            await pjsua_ready_event.wait()
            logger.info("✅ PJSUA prêt à consommer l'audio")

            # Exécuter le voice bridge avec tous les paramètres
            stats = await self.voice_bridge.run(
                runner=self.runner,
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

            logger.info("✅ Voice bridge terminé pour l'appel %s", call_id)
            logger.info("   Durée: %.2f secondes", stats.duration_seconds)
            logger.info("   Audio entrant: %d bytes", stats.inbound_audio_bytes)
            logger.info("   Audio sortant: %d bytes", stats.outbound_audio_bytes)
            logger.info("   Transcriptions: %d", stats.transcript_count)

            if stats.error:
                logger.error("   Erreur: %s", stats.error)

        except Exception as e:
            logger.error("❌ Erreur dans le voice bridge pour l'appel %s: %s", call_id, e)
            import traceback
            traceback.print_exc()
        finally:
            # Arrêter le bridge audio
            try:
                audio_bridge.stop()
                logger.info("✅ Bridge audio arrêté pour l'appel %s", call_id)
            except Exception as e:
                logger.warning("Erreur lors de l'arrêt du bridge audio: %s", e)

            # Nettoyer l'appel actif
            if call_id in self.active_calls:
                del self.active_calls[call_id]

    async def _on_close_dialog(self):
        """Hook appelé lors de la fermeture d'un dialogue."""
        logger.debug("Hook: close_dialog")

    async def _on_clear_voice_state(self):
        """Hook appelé pour nettoyer l'état vocal."""
        logger.debug("Hook: clear_voice_state")

    async def _on_resume_workflow(self, transcripts: list[dict[str, str]]):
        """Hook appelé pour reprendre le workflow avec les transcriptions."""
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
        logger.info("🎧 En attente d'appels entrants...")
        logger.info("   (Appuyez sur Ctrl+C pour arrêter)")

        import time
        start_time = time.time()

        try:
            while self.running:
                # Attendre un peu
                await asyncio.sleep(0.5)

                # Vérifier la durée si spécifiée
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
        logger.info("\n📊 Statistiques:")
        snapshot = self.metrics.snapshot()
        for key, value in snapshot.items():
            logger.info("  %s: %s", key, value)


async def main():
    """Point d'entrée principal."""
    parser = argparse.ArgumentParser(
        description="Test des appels entrants avec Voice Bridge",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  # Test basique
  %(prog)s --sip-uri sip:test@sip.example.com --username test --password secret

  # Test avec modèle et voix personnalisés
  %(prog)s --sip-uri sip:test@sip.example.com --username test --password secret \\
           --model gpt-4o-realtime-preview --voice shimmer

  # Test avec instructions personnalisées
  %(prog)s --sip-uri sip:test@sip.example.com --username test --password secret \\
           --instructions "Vous êtes un robot de test. Soyez bref."
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
        help="Modèle OpenAI à utiliser (défaut: gpt-4o-realtime-preview)"
    )
    parser.add_argument(
        "--voice",
        default="alloy",
        choices=["alloy", "echo", "shimmer", "ash", "ballad", "coral", "sage", "verse"],
        help="Voix à utiliser (défaut: alloy)"
    )
    parser.add_argument(
        "--instructions",
        default="Vous êtes un assistant vocal de test. Répondez brièvement aux questions.",
        help="Instructions pour l'assistant"
    )
    parser.add_argument(
        "--duration",
        type=int,
        default=0,
        help="Durée du test en secondes (0 = infini, défaut: 0)"
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

    # Ajuster le niveau de log si verbose
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    # Extraire le registrar de l'URI SIP si non spécifié
    registrar_uri = args.registrar_uri
    if not registrar_uri:
        if "@" in args.sip_uri:
            domain = args.sip_uri.split("@", 1)[1]
            registrar_uri = f"sip:{domain}"
        else:
            logger.error("❌ Impossible d'extraire le registrar de l'URI SIP")
            sys.exit(1)

    logger.info("=" * 60)
    logger.info("Test des appels entrants avec Voice Bridge")
    logger.info("=" * 60)
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
    tester = IncomingCallTester(
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

    logger.info("👋 Test terminé")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n⚠️ Interruption par l'utilisateur")
        sys.exit(0)
