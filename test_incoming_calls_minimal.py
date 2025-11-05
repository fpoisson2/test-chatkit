#!/home/fpoisson/.pyenv/versions/pjsip311/bin/python
"""Script minimal pour tester les appels entrants SIP.

Ce script est ultra-simple : il accepte les appels et joue un message prédéfini.
Parfait pour débuter et vérifier que PJSUA fonctionne.

Usage:
    python test_incoming_calls_minimal.py sip:user@domain.com username password
"""

import sys
import time

try:
    import pjsua2 as pj
except ImportError:
    print("❌ ERREUR: pjsua2 n'est pas installé")
    print("   Installez-le avec: pip install pjsua2")
    sys.exit(1)


class SimpleCall(pj.Call):
    """Gestionnaire d'appel simple."""

    def onCallState(self, prm):
        """Appelé quand l'état de l'appel change."""
        ci = self.getInfo()
        print(f"📞 État: {ci.stateText}")

        if ci.state == pj.PJSIP_INV_STATE_DISCONNECTED:
            print("❌ Appel terminé")

    def onCallMediaState(self, prm):
        """Appelé quand le média est prêt."""
        ci = self.getInfo()

        for mi in ci.media:
            if mi.type == pj.PJMEDIA_TYPE_AUDIO and mi.status == pj.PJSUA_CALL_MEDIA_ACTIVE:
                print("🎵 Audio actif!")

                # Connecter l'audio
                am = self.getAudioMedia(mi.index)
                ep = pj.Endpoint.instance()
                playback = ep.audDevManager().getPlaybackDevMedia()
                capture = ep.audDevManager().getCaptureDevMedia()

                # Bidirectionnel: micro → appel → haut-parleur
                capture.startTransmit(am)
                am.startTransmit(playback)

                print("🔊 Audio connecté (vous pouvez parler!)")


class SimpleAccount(pj.Account):
    """Gestionnaire de compte simple."""

    def onRegState(self, prm):
        """Appelé quand l'enregistrement change."""
        ai = self.getInfo()
        status = "✅ ENREGISTRÉ" if ai.regIsActive else "❌ ÉCHEC"
        print(f"{status} ({ai.regStatusText})")

    def onIncomingCall(self, prm):
        """Appelé quand un appel arrive."""
        call = SimpleCall(self, prm.callId)
        ci = call.getInfo()

        print("\n" + "=" * 50)
        print("📞 APPEL ENTRANT!")
        print(f"   De: {ci.remoteUri}")
        print("=" * 50)

        # Accepter automatiquement
        call_prm = pj.CallOpParam()
        call_prm.statusCode = 200
        call.answer(call_prm)
        print("✅ Appel accepté")


def main():
    """Point d'entrée."""
    # Vérifier les arguments
    if len(sys.argv) < 4:
        print("Usage: python test_incoming_calls_minimal.py SIP_URI USERNAME PASSWORD")
        print()
        print("Exemples:")
        print("  python test_incoming_calls_minimal.py sip:test@example.com test secret123")
        print("  python test_incoming_calls_minimal.py sip:1234@voip.provider.com 1234 mypass")
        sys.exit(1)

    sip_uri = sys.argv[1]
    username = sys.argv[2]
    password = sys.argv[3]

    # Extraire le domaine pour le registrar
    if "@" in sip_uri:
        domain = sip_uri.split("@", 1)[1]
        registrar_uri = f"sip:{domain}"
    else:
        print("❌ URI SIP invalide (doit contenir @)")
        sys.exit(1)

    print("=" * 50)
    print("Test Minimal des Appels Entrants")
    print("=" * 50)
    print(f"URI SIP: {sip_uri}")
    print(f"Registrar: {registrar_uri}")
    print(f"Username: {username}")
    print("=" * 50)
    print()

    # Initialiser PJSUA
    ep = pj.Endpoint()
    ep.libCreate()

    # Configuration minimale
    ep_cfg = pj.EpConfig()
    ep_cfg.logConfig.level = 3

    # Désactiver le VAD (Voice Activity Detection) pour simplifier
    ep_cfg.medConfig.noVad = True

    ep.libInit(ep_cfg)

    # Créer le transport UDP
    transport_cfg = pj.TransportConfig()
    transport_cfg.port = 5060
    ep.transportCreate(pj.PJSIP_TRANSPORT_UDP, transport_cfg)

    # Démarrer
    ep.libStart()
    print("✅ PJSUA démarré")

    # Note: Les erreurs Jack sont normales si le serveur Jack n'est pas démarré
    # PJSUA utilisera ALSA automatiquement en fallback
    print("ℹ️  Si vous voyez des erreurs Jack, c'est normal (PJSUA utilise ALSA)")

    # Créer le compte
    acc_cfg = pj.AccountConfig()
    acc_cfg.idUri = sip_uri
    acc_cfg.regConfig.registrarUri = registrar_uri

    # Authentification
    cred = pj.AuthCredInfo()
    cred.scheme = "digest"
    cred.realm = "*"
    cred.username = username
    cred.data = password
    cred.dataType = pj.PJSIP_CRED_DATA_PLAIN_PASSWD
    acc_cfg.sipConfig.authCreds.append(cred)

    # Créer le compte
    acc = SimpleAccount()
    acc.create(acc_cfg)
    print("✅ Compte créé")

    # Attendre l'enregistrement
    print("⏳ Attente de l'enregistrement...")
    time.sleep(2)

    # Boucle principale
    print()
    print("🎧 EN ATTENTE D'APPELS...")
    print("   (Appuyez sur Ctrl+C pour quitter)")
    print()

    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        print("\n\n⚠️ Arrêt demandé")

    # Nettoyage
    print("🧹 Nettoyage...")
    ep.libDestroy()
    print("👋 Au revoir!")


if __name__ == "__main__":
    main()
