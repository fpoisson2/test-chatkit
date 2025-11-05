#!/usr/bin/env python3
"""Test simple de création d'AudioMediaPort sans appel SIP réel.

Ce test vérifie que l'AudioMediaPort peut être créé sans crash.
"""

import sys
from pathlib import Path

# Ajouter le répertoire backend au path
ROOT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ROOT_DIR / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import os
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("AUTH_SECRET_KEY", "test-key")
os.environ.setdefault("CELERY_BROKER_URL", "redis://localhost:6379/0")
os.environ.setdefault("OPENAI_API_KEY", "test-key")

print("🧪 Test de création d'AudioMediaPort...")
print()

try:
    import pjsua2 as pj
    print("✅ PJSUA2 importé avec succès")
    print(f"   Version: {pj.Endpoint().libVersion().full}")

    # Créer un endpoint PJSUA minimal
    ep = pj.Endpoint()
    ep.libCreate()
    print("✅ Endpoint PJSUA créé")

    # Configurer l'endpoint
    ep_cfg = pj.EpConfig()
    ep.libInit(ep_cfg)
    print("✅ Endpoint PJSUA initialisé")

    # Maintenant tester la création d'AudioMediaPort
    print()
    print("🔧 Test de création d'AudioMediaPort...")

    from app.telephony.pjsua_adapter import PJSUAAdapter, AudioMediaPort
    import asyncio

    # Créer un adaptateur minimal
    adapter = PJSUAAdapter()

    # Créer un AudioMediaPort
    frame_event = asyncio.Event()
    audio_port = AudioMediaPort(adapter, frame_event, None)

    print("✅ AudioMediaPort créé avec succès!")
    print(f"   Sample rate: {audio_port.sample_rate} Hz")
    print(f"   Channels: {audio_port.channels}")
    print(f"   Bits per sample: {audio_port.bits_per_sample}")
    print(f"   Samples per frame: {audio_port.samples_per_frame}")

    # Nettoyer
    audio_port.deactivate(destroy_port=True)
    print("✅ AudioMediaPort nettoyé")

    ep.libDestroy()
    print("✅ Endpoint PJSUA détruit")

    print()
    print("🎉 Tous les tests ont réussi!")
    sys.exit(0)

except Exception as e:
    print(f"❌ Erreur: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
