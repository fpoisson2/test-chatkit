"""Simple WSOLA (Waveform Similarity Overlap-Add) time-stretch for telephony.

Implements a lightweight time-scale modification algorithm that can speed up
or slow down audio without changing pitch. Optimized for 8kHz telephony audio.

WSOLA principle:
- Divide audio into overlapping frames
- Use cross-correlation to find optimal splice points
- Overlap-add with windowing to avoid artifacts

Typical usage for catch-up mode:
- Speed up to 1.15x-1.25x when queue builds up
- Return to 1.0x when queue drains
"""

from __future__ import annotations

import logging
import numpy as np

logger = logging.getLogger("chatkit.telephony.timestretch")


class WSolaTimeStretch:
    """Simple WSOLA time-stretcher for telephony audio.

    Optimized for 8kHz PCM16 mono audio with speed ratios between 0.8x and 1.5x.
    Uses cross-correlation to find optimal splice points for artifact-free stretching.

    Args:
        sample_rate: Audio sample rate (typically 8000 Hz for telephony)
        frame_ms: Analysis frame size in milliseconds (default 20ms)
        overlap_ms: Overlap between frames in milliseconds (default 10ms)
        search_ms: Search region for cross-correlation in milliseconds (default 5ms)
    """

    def __init__(
        self,
        sample_rate: int = 8000,
        frame_ms: float = 20.0,
        overlap_ms: float = 10.0,
        search_ms: float = 5.0,
    ):
        self.sample_rate = sample_rate
        self.frame_size = int(sample_rate * frame_ms / 1000.0)  # 160 samples @ 8kHz
        self.overlap_size = int(sample_rate * overlap_ms / 1000.0)  # 80 samples @ 8kHz
        self.search_size = int(sample_rate * search_ms / 1000.0)  # 40 samples @ 8kHz

        # Hanning window for overlap-add (reduces clicks)
        self.window = np.hanning(self.overlap_size)

        # Buffer for leftover samples
        self._input_buffer = np.array([], dtype=np.int16)

        logger.info(
            "WSOLA TimeStretch initialized: frame=%d samples (%.1fms), "
            "overlap=%d samples (%.1fms), search=%d samples (%.1fms) @ %dHz",
            self.frame_size, frame_ms,
            self.overlap_size, overlap_ms,
            self.search_size, search_ms,
            sample_rate,
        )

    def process(self, audio_bytes: bytes, speed_ratio: float = 1.0) -> bytes:
        """Apply time-stretch to audio data.

        Args:
            audio_bytes: Input audio as PCM16 mono bytes
            speed_ratio: Speed multiplication factor (>1.0 = faster, <1.0 = slower)
                        1.0 = no change, 1.15 = 15% faster, 0.85 = 15% slower

        Returns:
            Time-stretched audio as PCM16 mono bytes
        """
        # Fast path: no stretching needed
        if abs(speed_ratio - 1.0) < 0.01:
            return audio_bytes

        # Convert bytes to int16 array
        audio_int16 = np.frombuffer(audio_bytes, dtype=np.int16)

        # Combine with leftover buffer from previous call
        if len(self._input_buffer) > 0:
            audio_int16 = np.concatenate([self._input_buffer, audio_int16])

        # Need at least 2 frames to process
        min_samples = self.frame_size * 2
        if len(audio_int16) < min_samples:
            # Not enough data, buffer it
            self._input_buffer = audio_int16
            return b''

        # Apply WSOLA
        stretched = self._wsola(audio_int16, speed_ratio)

        # Convert back to bytes
        return stretched.tobytes()

    def _wsola(self, audio: np.ndarray, speed_ratio: float) -> np.ndarray:
        """WSOLA core algorithm.

        Args:
            audio: Input samples as int16 array
            speed_ratio: Speed multiplication factor

        Returns:
            Time-stretched samples as int16 array
        """
        if len(audio) < self.frame_size * 2:
            return audio

        # Calculate hop sizes
        # synthesis_hop: how much we advance in output (fixed)
        # analysis_hop: how much we advance in input (varies with speed)
        synthesis_hop = self.frame_size - self.overlap_size  # 80 samples @ 8kHz
        analysis_hop = int(synthesis_hop * speed_ratio)  # ~92 samples for 1.15x

        # Estimate output size
        num_frames = (len(audio) - self.frame_size) // analysis_hop
        output_size = num_frames * synthesis_hop + self.frame_size
        output = np.zeros(output_size, dtype=np.float32)

        input_pos = 0
        output_pos = 0

        # Copy first frame as-is
        output[0:self.frame_size] = audio[0:self.frame_size].astype(np.float32)
        input_pos = analysis_hop
        output_pos = synthesis_hop

        frame_count = 0

        while input_pos + self.frame_size <= len(audio):  # <= au lieu de <
            # Extract reference overlap from output (for correlation)
            ref_start = output_pos - self.overlap_size
            ref_overlap = output[ref_start:output_pos]

            # Search for best match in input around predicted position
            search_start = max(0, input_pos - self.search_size)
            search_end = min(len(audio) - self.frame_size, input_pos + self.search_size)  # -frame_size pour garantir assez de samples

            # Find best correlation position
            best_pos = self._find_best_match(
                audio, ref_overlap, search_start, search_end
            )

            # Extract frame from best position - GARANTIR frame_size samples
            frame = audio[best_pos:best_pos + self.frame_size].astype(np.float32)

            # SAFETY: pad si frame trop court (ne devrait jamais arriver avec fix ci-dessus)
            if len(frame) < self.frame_size:
                frame = np.pad(frame, (0, self.frame_size - len(frame)), mode='constant')

            # Overlap-add with previous output
            overlap_region = frame[0:self.overlap_size]
            output_overlap_start = output_pos - self.overlap_size

            # Cross-fade using Hanning window
            for i in range(self.overlap_size):
                weight = self.window[i]  # 0 to 1
                output[output_overlap_start + i] = (
                    output[output_overlap_start + i] * (1.0 - weight) +
                    overlap_region[i] * weight
                )

            # Add non-overlapping part - GARANTIR synthesis_hop samples
            non_overlap_start = self.overlap_size
            non_overlap_part = frame[non_overlap_start:non_overlap_start + synthesis_hop]

            # SAFETY: pad si trop court
            if len(non_overlap_part) < synthesis_hop:
                non_overlap_part = np.pad(non_overlap_part, (0, synthesis_hop - len(non_overlap_part)), mode='constant')

            output[output_pos:output_pos + synthesis_hop] = non_overlap_part

            # Advance positions
            input_pos += analysis_hop
            output_pos += synthesis_hop
            frame_count += 1

        # Store leftover input for next call
        leftover_start = input_pos - analysis_hop + self.frame_size
        if leftover_start < len(audio):
            self._input_buffer = audio[leftover_start:].copy()
        else:
            self._input_buffer = np.array([], dtype=np.int16)

        # Clip and convert to int16
        output = np.clip(output[:output_pos], -32768, 32767).astype(np.int16)

        # CRITICAL: Arrondir au multiple de frame_size (160 samples @ 8kHz)
        # Évite les problèmes d'alignement quand on envoie à PJSUA
        output_len = len(output)
        frame_aligned_len = (output_len // self.frame_size) * self.frame_size

        if frame_aligned_len < output_len:
            # Pad au prochain multiple de frame_size pour garder alignement
            # Le padding de quelques samples (<160) est inaudible
            next_multiple = ((output_len + self.frame_size - 1) // self.frame_size) * self.frame_size
            output = np.pad(output, (0, next_multiple - output_len), mode='constant')
            logger.debug(
                "WSOLA padded %d samples → %d samples (frame alignment)",
                output_len, len(output)
            )

        logger.debug(
            "WSOLA processed %d frames: %d samples → %d samples (ratio=%.2fx, frame-aligned)",
            frame_count, len(audio), len(output), speed_ratio
        )

        return output

    def _find_best_match(
        self,
        audio: np.ndarray,
        reference: np.ndarray,
        search_start: int,
        search_end: int,
    ) -> int:
        """Find position with best waveform similarity using cross-correlation.

        Args:
            audio: Full input audio
            reference: Reference overlap region to match
            search_start: Start of search region
            search_end: End of search region

        Returns:
            Position with highest correlation
        """
        best_pos = search_start
        best_correlation = -float('inf')

        ref_float = reference.astype(np.float32)
        ref_norm = np.linalg.norm(ref_float)

        if ref_norm < 1e-6:
            # Silence, just return middle of search region
            return (search_start + search_end) // 2

        for pos in range(search_start, search_end):
            if pos + len(reference) > len(audio):
                break

            candidate = audio[pos:pos + len(reference)].astype(np.float32)

            # Normalized cross-correlation
            correlation = np.dot(ref_float, candidate)
            candidate_norm = np.linalg.norm(candidate)

            if candidate_norm > 1e-6:
                correlation /= (ref_norm * candidate_norm)

            if correlation > best_correlation:
                best_correlation = correlation
                best_pos = pos

        return best_pos

    def reset(self) -> None:
        """Reset internal buffers."""
        self._input_buffer = np.array([], dtype=np.int16)
        logger.debug("WSOLA buffers reset")

    def validate_output(self, output: bytes) -> bool:
        """Validate que la sortie est alignée sur frame_size.

        Args:
            output: Output bytes to validate

        Returns:
            True if valid (multiple of frame_size bytes)
        """
        frame_size_bytes = self.frame_size * 2  # 2 bytes per sample (PCM16)
        is_valid = (len(output) % frame_size_bytes) == 0

        if not is_valid:
            logger.warning(
                "WSOLA output NOT frame-aligned: %d bytes (should be multiple of %d)",
                len(output), frame_size_bytes
            )

        return is_valid


def create_timestretch(sample_rate: int = 8000) -> WSolaTimeStretch:
    """Create a WSOLA time-stretcher configured for telephony.

    Args:
        sample_rate: Audio sample rate (default 8000 Hz)

    Returns:
        Configured WSolaTimeStretch instance
    """
    return WSolaTimeStretch(
        sample_rate=sample_rate,
        frame_ms=20.0,  # 160 samples @ 8kHz - one RTP packet
        overlap_ms=10.0,  # 80 samples - 50% overlap
        search_ms=5.0,  # 40 samples - search region
    )
