"""Module de diagnostic pour tracer les problèmes de lag entre les appels.
Collecte des métriques détaillées sur chaque phase de traitement."""

import asyncio
import logging
import queue
import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class CallPhaseMetrics:
    """Métriques pour une phase spécifique d'un appel"""
    phase_name: str
    start_time: float | None = None
    end_time: float | None = None
    duration_ms: float | None = None
    metadata: dict = field(default_factory=dict)

    def start(self):
        """Démarre le chronomètre de la phase"""
        self.start_time = time.perf_counter()
        logger.debug(f"📊 Phase '{self.phase_name}' démarrée @ {self.start_time:.3f}s")

    def end(self, **metadata):
        """Termine le chronomètre et calcule la durée"""
        self.end_time = time.perf_counter()
        if self.start_time:
            self.duration_ms = (self.end_time - self.start_time) * 1000
        self.metadata.update(metadata)
        logger.info(f"⏱️ Phase '{self.phase_name}' terminée: {self.duration_ms:.1f}ms {metadata}")


@dataclass
class CallDiagnostics:
    """Collecte complète de diagnostics pour un appel."""

    call_id: str
    call_number: int = 0  # Numéro séquentiel (1er, 2e, 3e appel, etc.)
    session_id: str | None = None
    chatkit_call_id: str | None = None

    # Phases principales
    phase_ring: CallPhaseMetrics = field(default_factory=lambda: CallPhaseMetrics("ring"))
    phase_session_create: CallPhaseMetrics = field(default_factory=lambda: CallPhaseMetrics("session_create"))
    phase_sdk_connect: CallPhaseMetrics = field(default_factory=lambda: CallPhaseMetrics("sdk_connect"))
    phase_media_active: CallPhaseMetrics = field(default_factory=lambda: CallPhaseMetrics("media_active"))
    phase_first_rtp: CallPhaseMetrics = field(default_factory=lambda: CallPhaseMetrics("first_rtp"))
    phase_first_tts: CallPhaseMetrics = field(default_factory=lambda: CallPhaseMetrics("first_tts"))
    phase_response_create: CallPhaseMetrics = field(default_factory=lambda: CallPhaseMetrics("response_create"))

    # Métriques de ressources
    buffers_state: dict[str, int] = field(default_factory=dict)
    port_reuse_count: int = 0
    port_recreated: bool = False
    none_packets_before_audio: int = 0
    cleanup_done: bool = False
    call_closed: bool = False
    call_terminated: bool = False

    # Compteurs runtime (encapsulent les métriques AudioMediaPort)
    frames_requested: int = 0
    outgoing_audio_frames: int = 0
    outgoing_silence_frames: int = 0
    incoming_frames: int = 0

    # OpenAI API
    openai_response_times: list[float] = field(default_factory=list)

    # État final
    total_duration_s: float | None = None
    lag_detected: bool = False
    lag_sources: list[str] = field(default_factory=list)

    def add_buffer_state(self, buffer_name: str, size: int):
        """Enregistre l'état d'un buffer"""
        self.buffers_state[buffer_name] = size
        logger.debug(f"📦 Buffer '{buffer_name}': {size} items")

    def add_openai_timing(self, response_time_ms: float):
        """Enregistre un temps de réponse OpenAI"""
        self.openai_response_times.append(response_time_ms)
        logger.debug(f"🌐 OpenAI response: {response_time_ms:.1f}ms")

    def detect_lag_sources(self):
        """Analyse les métriques pour détecter les sources de lag"""
        self.lag_sources = []

        # 1. TTS anormalement lent (>600ms)
        if self.phase_first_tts.duration_ms and self.phase_first_tts.duration_ms > 600:
            self.lag_sources.append(f"TTS_SLOW:{self.phase_first_tts.duration_ms:.0f}ms")

        # 2. Connexion SDK lente (>500ms)
        if self.phase_sdk_connect.duration_ms and self.phase_sdk_connect.duration_ms > 500:
            self.lag_sources.append(f"SDK_CONNECT_SLOW:{self.phase_sdk_connect.duration_ms:.0f}ms")

        # 3. Retard RTP (>10 None packets avant audio)
        if self.none_packets_before_audio > 10:
            self.lag_sources.append(f"RTP_DELAY:{self.none_packets_before_audio}_none_packets")

        # 4. Port recréé (signe de problème)
        if self.port_recreated:
            self.lag_sources.append("PORT_RECREATED")

        # 5. Buffers non vidés
        for buffer_name, size in self.buffers_state.items():
            if size > 0 and "before_call" in buffer_name:
                self.lag_sources.append(f"BUFFER_NOT_EMPTY:{buffer_name}={size}")

        self.lag_detected = len(self.lag_sources) > 0

        return self.lag_sources

    # === Gestion du cycle de vie ===

    def set_chatkit_call_id(self, chatkit_call_id: str | None) -> None:
        """Associe l'identifiant ChatKit à ce diagnostic."""

        self.chatkit_call_id = chatkit_call_id

    def mark_terminated(self) -> None:
        """Marque l'appel comme terminé côté PJSUA."""

        self.call_terminated = True

    def mark_closed(self) -> None:
        """Marque l'appel comme fermé côté adaptateur."""

        self.call_closed = True

    def mark_cleanup_done(self) -> None:
        """Enregistre que le cleanup complet a été exécuté."""

        self.cleanup_done = True

    def reset_cleanup_state(self) -> None:
        """Réinitialise les flags de cleanup (nouvelle session)."""

        self.cleanup_done = False
        self.call_closed = False
        self.call_terminated = False

    def should_skip_cleanup(self) -> bool:
        """Indique si le cleanup a déjà été effectué."""

        return self.cleanup_done or self.call_closed

    # === Gestion des compteurs audio ===

    def reset_frame_counters(self) -> None:
        """Réinitialise tous les compteurs d'AudioMediaPort."""

        self.frames_requested = 0
        self.outgoing_audio_frames = 0
        self.outgoing_silence_frames = 0
        self.incoming_frames = 0

    def record_frame_requested(self) -> int:
        """Incrémente le compteur de frames demandées."""

        self.frames_requested += 1
        return self.frames_requested

    def record_outgoing_frame(self, *, is_silence: bool) -> tuple[int, int]:
        """Enregistre un frame sortant (total + silence)."""

        self.outgoing_audio_frames += 1
        if is_silence:
            self.outgoing_silence_frames += 1
        return self.outgoing_audio_frames, self.outgoing_silence_frames

    def record_incoming_frame(self) -> int:
        """Enregistre un frame entrant provenant du téléphone."""

        self.incoming_frames += 1
        return self.incoming_frames

    # === Gestion des ports audio ===

    @staticmethod
    def _drain_queue(queue_obj: Any) -> int:
        """Vide une queue de manière non bloquante et retourne le nombre d'éléments retirés."""

        if queue_obj is None:
            return 0

        drained = 0
        try:
            while True:
                queue_obj.get_nowait()
                drained += 1
        except queue.Empty:
            pass
        return drained

    def prepare_audio_port(
        self,
        port: Any,
        frame_requested_event: asyncio.Event | None,
        audio_bridge: Any | None = None,
    ) -> tuple[int, int]:
        """Réinitialise l'état du port audio pour un nouvel appel."""

        # Mettre à jour les références runtime
        if port is None:
            return (0, 0)

        if frame_requested_event is not None:
            port._frame_requested_event = frame_requested_event
        else:
            port._frame_requested_event = None

        port._audio_bridge = audio_bridge
        port._active = True

        # Réinitialiser les compteurs
        self.reset_frame_counters()
        if hasattr(port, "_frame_count"):
            port._frame_count = 0
        if hasattr(port, "_audio_frame_count"):
            port._audio_frame_count = 0
        if hasattr(port, "_silence_frame_count"):
            port._silence_frame_count = 0
        if hasattr(port, "_frame_received_count"):
            port._frame_received_count = 0

        # Vider les queues et enregistrer leur état
        incoming_drained = self._drain_queue(getattr(port, "_incoming_audio_queue", None))
        outgoing_drained = self._drain_queue(getattr(port, "_outgoing_audio_queue", None))

        self.add_buffer_state("incoming_queue_before_call", incoming_drained)
        self.add_buffer_state("outgoing_queue_before_call", outgoing_drained)

        return incoming_drained, outgoing_drained

    def record_port_reuse(self, reuse_count: int, *, recreated: bool) -> None:
        """Mise à jour des métriques liées à la réutilisation des ports."""

        self.port_reuse_count = reuse_count
        self.port_recreated = recreated

    def generate_report(self) -> str:
        """Génère un rapport détaillé des diagnostics"""
        self.detect_lag_sources()

        report = [
            f"\n{'='*80}",
            f"📊 DIAGNOSTIC DÉTAILLÉ - Appel #{self.call_number} (call_id={self.call_id})",
            f"{'='*80}",
            "",
            "⏱️  TIMINGS DES PHASES:",
        ]

        phases = [
            self.phase_ring,
            self.phase_session_create,
            self.phase_sdk_connect,
            self.phase_media_active,
            self.phase_first_rtp,
            self.phase_response_create,
            self.phase_first_tts,
        ]

        for phase in phases:
            if phase.duration_ms is not None:
                status = "⚠️" if phase.duration_ms > 500 else "✅"
                report.append(f"  {status} {phase.phase_name:20s}: {phase.duration_ms:6.1f}ms")
                if phase.metadata:
                    report.append(f"      └─ {phase.metadata}")

        report.extend([
            "",
            "📦 ÉTAT DES BUFFERS:",
        ])
        for buffer_name, size in sorted(self.buffers_state.items()):
            status = "⚠️" if size > 0 and "before" in buffer_name else "✅"
            report.append(f"  {status} {buffer_name}: {size}")

        report.extend([
            "",
            "🔧 RESSOURCES:",
            f"  • Port recréé: {'OUI ⚠️' if self.port_recreated else 'NON ✅'}",
            f"  • Port reuse count: {self.port_reuse_count}",
            f"  • None packets avant audio: {self.none_packets_before_audio}",
        ])

        if self.openai_response_times:
            avg_time = sum(self.openai_response_times) / len(self.openai_response_times)
            report.extend([
                "",
                "🌐 OPENAI API:",
                f"  • Nb requêtes: {len(self.openai_response_times)}",
                f"  • Temps moyen: {avg_time:.1f}ms",
                f"  • Temps min/max: {min(self.openai_response_times):.1f}/{max(self.openai_response_times):.1f}ms",
            ])

        if self.lag_detected:
            report.extend([
                "",
                "🚨 SOURCES DE LAG DÉTECTÉES:",
            ])
            for source in self.lag_sources:
                report.append(f"  ⚠️ {source}")
        else:
            report.extend([
                "",
                "✅ Aucun lag détecté - Performance normale",
            ])

        report.append(f"{'='*80}\n")

        return "\n".join(report)


class CallDiagnosticsManager:
    """Gestionnaire global des diagnostics d'appels"""

    def __init__(self):
        self._lock = Lock()
        self._calls: dict[str, CallDiagnostics] = {}
        self._call_sequence = 0
        self._comparison_data: list[dict] = []

    def start_call(self, call_id: str) -> CallDiagnostics:
        """Démarre le diagnostic pour un nouvel appel"""
        with self._lock:
            self._call_sequence += 1
            diag = CallDiagnostics(
                call_id=call_id,
                call_number=self._call_sequence
            )
            self._calls[call_id] = diag
            logger.info(f"🎯 Diagnostic démarré pour appel #{self._call_sequence} (call_id={call_id})")
            return diag

    def get_call(self, call_id: str) -> CallDiagnostics | None:
        """Récupère le diagnostic d'un appel"""
        with self._lock:
            return self._calls.get(call_id)

    def end_call(self, call_id: str):
        """Termine le diagnostic et génère le rapport"""
        with self._lock:
            diag = self._calls.get(call_id)
            if not diag:
                return

            # Génère et affiche le rapport
            report = diag.generate_report()
            logger.warning(report)  # WARNING pour qu'il soit visible

            # Stocke pour comparaison (LIMITÉ aux 50 derniers appels)
            self._comparison_data.append({
                'call_number': diag.call_number,
                'call_id': call_id,
                'tts_delay': diag.phase_first_tts.duration_ms,
                'sdk_connect': diag.phase_sdk_connect.duration_ms,
                'none_packets': diag.none_packets_before_audio,
                'lag_sources': diag.lag_sources,
            })

            # CRITICAL FIX: Auto-cleanup to prevent unlimited accumulation
            # Keep only last 50 calls in comparison data
            MAX_COMPARISON_DATA = 50
            if len(self._comparison_data) > MAX_COMPARISON_DATA:
                self._comparison_data = self._comparison_data[-MAX_COMPARISON_DATA:]
                logger.debug(f"🧹 Comparison data trimmed to {MAX_COMPARISON_DATA} most recent calls")

            # Auto-cleanup _calls dict (keep last 20)
            self.cleanup_old_calls(keep_last_n=20)

    def generate_comparison_report(self) -> str:
        """Génère un rapport comparatif entre tous les appels"""
        if len(self._comparison_data) < 2:
            return ""

        report = [
            f"\n{'='*80}",
            f"📊 RAPPORT COMPARATIF - {len(self._comparison_data)} appels",
            f"{'='*80}",
            "",
            f"{'Appel':<8} {'TTS (ms)':<12} {'SDK (ms)':<12} {'None Pkts':<12} {'Lag Sources'}",
            f"{'-'*80}",
        ]

        for data in self._comparison_data:
            tts = f"{data['tts_delay']:.0f}" if data['tts_delay'] else "N/A"
            sdk = f"{data['sdk_connect']:.0f}" if data['sdk_connect'] else "N/A"
            none = str(data['none_packets'])
            sources = ", ".join(data['lag_sources']) if data['lag_sources'] else "✅ OK"

            report.append(f"#{data['call_number']:<7} {tts:<12} {sdk:<12} {none:<12} {sources}")

        # Détection de dégradation
        if len(self._comparison_data) >= 3:
            tts_times = [d['tts_delay'] for d in self._comparison_data if d['tts_delay']]
            if len(tts_times) >= 3:
                degradation = tts_times[-1] - tts_times[0]
                if degradation > 200:
                    report.extend([
                        "",
                        "🚨 DÉGRADATION DÉTECTÉE:",
                        f"  • TTS: +{degradation:.0f}ms entre l'appel 1 et {len(tts_times)}",
                    ])

        report.append(f"{'='*80}\n")

        return "\n".join(report)

    def cleanup_old_calls(self, keep_last_n: int = 10):
        """Nettoie les anciens diagnostics (garde seulement les N derniers)"""
        with self._lock:
            if len(self._calls) > keep_last_n:
                # Trie par call_number et garde les plus récents
                sorted_calls = sorted(
                    self._calls.items(),
                    key=lambda x: x[1].call_number,
                    reverse=True
                )
                self._calls = dict(sorted_calls[:keep_last_n])
                logger.debug(f"🧹 Nettoyage: {len(sorted_calls) - keep_last_n} anciens diagnostics supprimés")


# Instance globale
_diagnostics_manager = CallDiagnosticsManager()


def get_diagnostics_manager() -> CallDiagnosticsManager:
    """Retourne l'instance globale du gestionnaire de diagnostics"""
    return _diagnostics_manager
