"""High-quality audio resampling with multiple backend support.

This module provides a unified interface for audio resampling with automatic
backend selection:
- soxr (preferred): High quality, low CPU, well-maintained
- audioop (fallback): Built-in Python, lower quality but always available

Usage:
    resampler = get_resampler(from_rate=8000, to_rate=24000)
    output = resampler.resample(input_pcm16_bytes)
"""

from __future__ import annotations

import audioop
import logging
from abc import ABC, abstractmethod
from typing import Any

logger = logging.getLogger("chatkit.telephony.resampler")


class Resampler(ABC):
    """Abstract base class for audio resamplers.

    All resamplers work with PCM16 (16-bit signed integer) mono audio.
    """

    def __init__(self, from_rate: int, to_rate: int, channels: int = 1):
        """Initialize resampler.

        Args:
            from_rate: Input sample rate (Hz)
            to_rate: Output sample rate (Hz)
            channels: Number of audio channels (default: 1 = mono)
        """
        self.from_rate = from_rate
        self.to_rate = to_rate
        self.channels = channels
        self.ratio = to_rate / from_rate

    @abstractmethod
    def resample(self, audio_data: bytes) -> bytes:
        """Resample audio data.

        Args:
            audio_data: PCM16 audio bytes at from_rate

        Returns:
            Resampled PCM16 audio bytes at to_rate
        """
        pass

    @abstractmethod
    def reset(self) -> None:
        """Reset internal state for a new audio stream."""
        pass


class SoxrResampler(Resampler):
    """High-quality resampler using libsoxr (SoX Resampler library).

    soxr provides:
    - Very high quality resampling
    - Low CPU usage
    - Stateless operation (suitable for streaming)
    - Professional-grade quality ('VHQ' mode)
    """

    def __init__(self, from_rate: int, to_rate: int, channels: int = 1):
        super().__init__(from_rate, to_rate, channels)

        try:
            import soxr
            self.soxr = soxr
            logger.info(
                "✅ SoxrResampler initialized: %d Hz → %d Hz (ratio=%.2fx, quality=VHQ)",
                from_rate,
                to_rate,
                self.ratio,
            )
        except ImportError:
            raise ImportError(
                "soxr not available. Install with: pip install soxr"
            )

    def resample(self, audio_data: bytes) -> bytes:
        """Resample using soxr with VHQ (Very High Quality) mode.

        soxr automatically handles:
        - Sample format conversion (int16 from/to bytes)
        - Anti-aliasing filtering
        - Stateless operation (no internal buffer management needed)

        Args:
            audio_data: PCM16 mono audio bytes at from_rate

        Returns:
            PCM16 mono audio bytes at to_rate
        """
        import numpy as np

        # Convert bytes → int16 numpy array
        # PCM16 = 2 bytes per sample, little-endian signed
        audio_int16 = np.frombuffer(audio_data, dtype=np.int16)

        # Resample with VHQ (Very High Quality) mode
        # soxr.resample returns float64, we'll convert back to int16
        resampled_float = self.soxr.resample(
            audio_int16.astype(np.float32) / 32768.0,  # Normalize to [-1, 1]
            self.from_rate,
            self.to_rate,
            quality='VHQ'  # Very High Quality - best for voice
        )

        # Convert back to int16
        resampled_int16 = np.clip(resampled_float * 32768.0, -32768, 32767).astype(np.int16)

        # Convert numpy array → bytes
        return resampled_int16.tobytes()

    def reset(self) -> None:
        """Reset state (no-op for soxr - it's stateless)."""
        pass


class AudioopResampler(Resampler):
    """Fallback resampler using Python's built-in audioop module.

    audioop provides:
    - Basic resampling (linear interpolation)
    - Lower quality than soxr
    - Stateful operation (maintains partial samples between calls)
    - Always available (built-in Python module)
    """

    def __init__(self, from_rate: int, to_rate: int, channels: int = 1):
        super().__init__(from_rate, to_rate, channels)
        self._state: Any = None
        logger.info(
            "⚠️ AudioopResampler (fallback) initialized: %d Hz → %d Hz (ratio=%.2fx)",
            from_rate,
            to_rate,
            self.ratio,
        )

    def resample(self, audio_data: bytes) -> bytes:
        """Resample using audioop.ratecv (linear interpolation).

        Args:
            audio_data: PCM16 mono audio bytes at from_rate

        Returns:
            PCM16 mono audio bytes at to_rate
        """
        resampled, self._state = audioop.ratecv(
            audio_data,
            2,  # 2 bytes per sample (PCM16)
            self.channels,
            self.from_rate,
            self.to_rate,
            self._state,
        )
        return resampled

    def reset(self) -> None:
        """Reset internal state for a new audio stream."""
        self._state = None


def get_resampler(from_rate: int, to_rate: int, channels: int = 1) -> Resampler:
    """Get the best available resampler for the given rates.

    Priority:
    1. SoxrResampler (if soxr is installed) - high quality
    2. AudioopResampler (fallback) - basic quality, always available

    Args:
        from_rate: Input sample rate (Hz)
        to_rate: Output sample rate (Hz)
        channels: Number of audio channels (default: 1)

    Returns:
        Best available Resampler instance
    """
    # Try soxr first (preferred)
    try:
        return SoxrResampler(from_rate, to_rate, channels)
    except ImportError:
        logger.warning(
            "soxr not available, falling back to audioop (lower quality). "
            "Install soxr for better quality: pip install soxr"
        )
        return AudioopResampler(from_rate, to_rate, channels)
