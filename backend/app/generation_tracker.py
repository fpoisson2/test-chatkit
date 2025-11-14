"""
Tracker pour l'état de génération des threads ChatKit.

Ce module maintient un registre en mémoire des threads actuellement en train de générer,
permettant au frontend de vérifier si un workflow est actif.
"""

from __future__ import annotations

import time
from typing import Dict, Set


class GenerationTracker:
    """Suivi des threads en cours de génération."""

    def __init__(self) -> None:
        # Map de thread_id -> timestamp de début de génération
        self._generating_threads: Dict[str, float] = {}
        # Timeout après lequel on considère qu'un thread n'est plus en génération (30 secondes)
        self._timeout = 30.0

    def start_generating(self, thread_id: str) -> None:
        """Marque un thread comme étant en génération."""
        self._generating_threads[thread_id] = time.time()

    def stop_generating(self, thread_id: str) -> None:
        """Marque un thread comme ayant terminé la génération."""
        self._generating_threads.pop(thread_id, None)

    def is_generating(self, thread_id: str) -> bool:
        """Vérifie si un thread est actuellement en génération."""
        if thread_id not in self._generating_threads:
            return False

        # Vérifier si le timestamp n'a pas expiré
        start_time = self._generating_threads[thread_id]
        if time.time() - start_time > self._timeout:
            # Nettoyage automatique des entrées expirées
            self._generating_threads.pop(thread_id, None)
            return False

        return True

    def cleanup_expired(self) -> None:
        """Nettoie les entrées expirées du tracker."""
        current_time = time.time()
        expired = [
            thread_id
            for thread_id, start_time in self._generating_threads.items()
            if current_time - start_time > self._timeout
        ]
        for thread_id in expired:
            self._generating_threads.pop(thread_id, None)

    def get_generating_threads(self) -> Set[str]:
        """Retourne l'ensemble des threads actuellement en génération."""
        self.cleanup_expired()
        return set(self._generating_threads.keys())


# Instance globale du tracker
_tracker = GenerationTracker()


def get_generation_tracker() -> GenerationTracker:
    """Retourne l'instance globale du tracker de génération."""
    return _tracker
