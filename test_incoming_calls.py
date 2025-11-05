#!/home/fpoisson/.pyenv/versions/pjsip311/bin/python
"""Script de test pour les appels entrants SIP.

Ce script configure PJSUA pour recevoir des appels entrants et les accepter automatiquement.
Il joue un message de test et permet de vérifier que la réception d'appels fonctionne correctement.

Usage:
    python test_incoming_calls.py --sip-uri sip:user@domain.com --username user --password pass
"""

import argparse
import asyncio
import logging
import sys
import time
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
logger = logging.getLogger("test_incoming_calls")

try:
    import pjsua2 as pj
    PJSUA_AVAILABLE = True
    logger.info("✅ PJSUA2 chargé avec succès")
except ImportError as e:
    logger.error("❌ pjsua2 n'est pas disponible: %s", e)
    logger.error("Installez pjsua2 avec: pip install pjsua2")
    PJSUA_AVAILABLE = False
    sys.exit(1)


class TestCall(pj.Call):
    """Gestionnaire d'appel de test."""

    def __init__(self, account, call_id=pj.PJSUA_INVALID_ID):
        super().__init__(account, call_id)
        self.connected = False
        self.media_active = False

    def onCallState(self, prm):
        """Appelé lors d'un changement d'état de l'appel."""
        ci = self.getInfo()
        logger.info("📞 État de l'appel: %s", ci.stateText)

        # Si l'appel est confirmé (connecté)
        if ci.state == pj.PJSIP_INV_STATE_CONFIRMED:
            self.connected = True
            logger.info("✅ Appel connecté!")

        # Si l'appel est déconnecté
        elif ci.state == pj.PJSIP_INV_STATE_DISCONNECTED:
            logger.info("❌ Appel déconnecté")
            self.connected = False
            self.media_active = False

    def onCallMediaState(self, prm):
        """Appelé lors d'un changement d'état du média."""
        ci = self.getInfo()

        # Itérer sur tous les médias de l'appel
        for mi in ci.media:
            if mi.type == pj.PJMEDIA_TYPE_AUDIO:
                # Obtenir le média audio
                am = self.getAudioMedia(mi.index)

                if mi.status == pj.PJSUA_CALL_MEDIA_ACTIVE:
                    logger.info("🎵 Média audio actif")
                    self.media_active = True

                    # Obtenir le port de lecture du système
                    try:
                        # Connecter l'appel au haut-parleur
                        ep = pj.Endpoint.instance()
                        audDevManager = ep.audDevManager()
                        playback_dev = audDevManager.getPlaybackDevMedia()

                        # Connecter l'audio de l'appel au haut-parleur
                        am.startTransmit(playback_dev)

                        # Connecter le microphone à l'appel
                        capture_dev = audDevManager.getCaptureDevMedia()
                        capture_dev.startTransmit(am)

                        logger.info("🔊 Audio connecté: microphone → appel → haut-parleur")
                    except Exception as e:
                        logger.error("Erreur lors de la connexion audio: %s", e)

                elif mi.status == pj.PJSUA_CALL_MEDIA_NONE:
                    logger.info("🔇 Média audio désactivé")
                    self.media_active = False


class TestAccount(pj.Account):
    """Gestionnaire de compte SIP de test."""

    def __init__(self):
        super().__init__()
        self.current_call = None

    def onRegState(self, prm):
        """Appelé lors d'un changement d'état d'enregistrement."""
        ai = self.getInfo()
        logger.info(
            "📋 Enregistrement SIP: %s (code=%d)",
            ai.regStatusText,
            ai.regStatus,
        )

        if ai.regIsActive:
            logger.info("✅ Enregistrement SIP réussi!")
        else:
            logger.warning("⚠️ Enregistrement SIP échoué")

    def onIncomingCall(self, prm):
        """Appelé lors d'un appel entrant."""
        # Créer un objet Call pour gérer cet appel
        call = TestCall(self, prm.callId)
        call_info = call.getInfo()

        logger.info("📞 ===== APPEL ENTRANT =====")
        logger.info("📞 De: %s", call_info.remoteUri)
        logger.info("📞 Vers: %s", call_info.localUri)

        # Accepter automatiquement l'appel
        try:
            call_prm = pj.CallOpParam()
            call_prm.statusCode = 200  # OK
            call.answer(call_prm)
            logger.info("✅ Appel accepté automatiquement")

            # Sauvegarder la référence à l'appel
            self.current_call = call
        except Exception as e:
            logger.error("❌ Erreur lors de l'acceptation de l'appel: %s", e)


class PJSUATestManager:
    """Gestionnaire de test PJSUA pour les appels entrants."""

    def __init__(self, sip_uri: str, registrar_uri: str, username: str, password: str,
                 transport: str = "UDP", port: int = 5060):
        self.sip_uri = sip_uri
        self.registrar_uri = registrar_uri
        self.username = username
        self.password = password
        self.transport_type = transport.upper()
        self.port = port

        self.ep = None
        self.transport_id = None
        self.account = None
        self.running = False

    async def initialize(self):
        """Initialise PJSUA."""
        logger.info("🚀 Initialisation de PJSUA...")

        try:
            # Créer l'endpoint
            self.ep = pj.Endpoint()
            self.ep.libCreate()

            # Configuration de l'endpoint
            ep_cfg = pj.EpConfig()
            ep_cfg.logConfig.level = 4  # Niveau de log
            ep_cfg.logConfig.consoleLevel = 4

            # Configuration UAC (User Agent Client)
            ep_cfg.uaConfig.userAgent = "ChatKit-Test-Incoming/1.0"
            ep_cfg.uaConfig.maxCalls = 4

            # Initialiser l'endpoint
            self.ep.libInit(ep_cfg)

            # Créer le transport
            transport_cfg = pj.TransportConfig()
            transport_cfg.port = self.port

            if self.transport_type == "UDP":
                self.transport_id = self.ep.transportCreate(pj.PJSIP_TRANSPORT_UDP, transport_cfg)
            elif self.transport_type == "TCP":
                self.transport_id = self.ep.transportCreate(pj.PJSIP_TRANSPORT_TCP, transport_cfg)
            else:
                raise ValueError(f"Transport non supporté: {self.transport_type}")

            logger.info("✅ Transport %s créé sur le port %d", self.transport_type, self.port)

            # Démarrer l'endpoint
            self.ep.libStart()
            logger.info("✅ PJSUA démarré")

            # Créer et configurer le compte
            await self._create_account()

        except Exception as e:
            logger.error("❌ Erreur lors de l'initialisation de PJSUA: %s", e)
            raise

    async def _create_account(self):
        """Crée et enregistre le compte SIP."""
        logger.info("📋 Création du compte SIP...")

        try:
            # Configuration du compte
            acc_cfg = pj.AccountConfig()
            acc_cfg.idUri = self.sip_uri
            acc_cfg.regConfig.registrarUri = self.registrar_uri

            # Authentification
            cred = pj.AuthCredInfo()
            cred.scheme = "digest"
            cred.realm = "*"
            cred.username = self.username
            cred.data = self.password
            cred.dataType = pj.PJSIP_CRED_DATA_PLAIN_PASSWD
            acc_cfg.sipConfig.authCreds.append(cred)

            # Créer le compte
            self.account = TestAccount()
            self.account.create(acc_cfg)

            logger.info("✅ Compte SIP créé: %s", self.sip_uri)

        except Exception as e:
            logger.error("❌ Erreur lors de la création du compte: %s", e)
            raise

    async def run(self, duration: int = 0):
        """Exécute le gestionnaire de test.

        Args:
            duration: Durée en secondes (0 = infini)
        """
        self.running = True
        logger.info("🎧 En attente d'appels entrants...")
        logger.info("   (Appuyez sur Ctrl+C pour arrêter)")

        start_time = time.time()

        try:
            while self.running:
                # Attendre un peu pour ne pas surcharger le CPU
                await asyncio.sleep(0.1)

                # Vérifier la durée si spécifiée
                if duration > 0 and (time.time() - start_time) >= duration:
                    logger.info("⏱️ Durée de test écoulée")
                    break

        except KeyboardInterrupt:
            logger.info("\n⚠️ Interruption par l'utilisateur")
        finally:
            await self.cleanup()

    async def cleanup(self):
        """Nettoie les ressources PJSUA."""
        logger.info("🧹 Nettoyage...")

        self.running = False

        try:
            if self.account:
                # Désenregistrer le compte
                try:
                    self.account.shutdown()
                except Exception as e:
                    logger.warning("Erreur lors de la désinscription: %s", e)

            if self.ep:
                # Détruire l'endpoint
                try:
                    self.ep.libDestroy()
                except Exception as e:
                    logger.warning("Erreur lors de la destruction de l'endpoint: %s", e)

            logger.info("✅ Nettoyage terminé")

        except Exception as e:
            logger.error("❌ Erreur lors du nettoyage: %s", e)


async def main():
    """Point d'entrée principal."""
    parser = argparse.ArgumentParser(
        description="Test des appels entrants SIP avec PJSUA",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  # Test avec un compte SIP
  %(prog)s --sip-uri sip:test@sip.example.com --username test --password secret

  # Test avec un timeout de 60 secondes
  %(prog)s --sip-uri sip:test@sip.example.com --username test --password secret --duration 60

  # Test avec TCP
  %(prog)s --sip-uri sip:test@sip.example.com --username test --password secret --transport TCP --port 5061
        """
    )

    parser.add_argument(
        "--sip-uri",
        required=True,
        help="URI SIP du compte (ex: sip:user@domain.com)"
    )
    parser.add_argument(
        "--registrar-uri",
        help="URI du registrar SIP (ex: sip:domain.com). Si non spécifié, extrait de --sip-uri"
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
        "--duration",
        type=int,
        default=0,
        help="Durée du test en secondes (0 = infini, défaut: 0)"
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
        logger.setLevel(logging.DEBUG)

    # Extraire le registrar de l'URI SIP si non spécifié
    registrar_uri = args.registrar_uri
    if not registrar_uri:
        # Extraire le domaine de l'URI SIP
        # Format: sip:user@domain.com -> sip:domain.com
        if "@" in args.sip_uri:
            domain = args.sip_uri.split("@", 1)[1]
            registrar_uri = f"sip:{domain}"
        else:
            logger.error("❌ Impossible d'extraire le registrar de l'URI SIP. Spécifiez --registrar-uri")
            sys.exit(1)

    logger.info("=" * 60)
    logger.info("Test des appels entrants SIP")
    logger.info("=" * 60)
    logger.info("SIP URI: %s", args.sip_uri)
    logger.info("Registrar: %s", registrar_uri)
    logger.info("Transport: %s sur port %d", args.transport, args.port)
    logger.info("=" * 60)

    # Créer et initialiser le gestionnaire
    manager = PJSUATestManager(
        sip_uri=args.sip_uri,
        registrar_uri=registrar_uri,
        username=args.username,
        password=args.password,
        transport=args.transport,
        port=args.port
    )

    try:
        await manager.initialize()
        await manager.run(duration=args.duration)
    except Exception as e:
        logger.error("❌ Erreur fatale: %s", e)
        sys.exit(1)

    logger.info("👋 Test terminé")


if __name__ == "__main__":
    if not PJSUA_AVAILABLE:
        sys.exit(1)

    # Exécuter le script avec asyncio
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n⚠️ Interruption par l'utilisateur")
        sys.exit(0)
