"""
Configuration Celery pour les tâches background.
"""
from __future__ import annotations

import os
from celery import Celery

# URL de Redis depuis les variables d'environnement
REDIS_URL = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")

# Créer l'application Celery
celery_app = Celery(
    "chatkit",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=["app.tasks.language_generation"]
)

# Configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=3600,  # 1 heure max par tâche
    task_soft_time_limit=3300,  # Warning après 55 minutes
    worker_prefetch_multiplier=1,  # Une tâche à la fois par worker
    worker_max_tasks_per_child=50,  # Redémarrer après 50 tâches
)
