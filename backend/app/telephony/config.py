"""Pure helpers that describe how we configure the PJSUA endpoint."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LoggingSettings:
    """Logging parameters applied on :class:`pj.EpConfig`."""

    level: int = 1
    console_level: int = 1


@dataclass(frozen=True)
class SessionTimerSettings:
    """Aggressive SIP session timers to avoid ghost calls."""

    main_thread_only: bool = False
    nat_type_in_sdp: int = 0
    timer_use: int = 3
    timer_min_se: int = 90
    timer_sess_expires: int = 180


@dataclass(frozen=True)
class JitterBufferSettings:
    """Tuning for the jitter buffer to keep latency predictable."""

    jb_init: int = 1
    jb_min_pre: int = 1
    jb_max_pre: int = 4
    jb_max: int = 10
    snd_auto_close_time: int = 0


@dataclass(frozen=True)
class RtpSettings:
    """Explicit RTP port allocation for predictable firewall rules."""

    start_port: int = 10000
    port_range: int = 10000


@dataclass(frozen=True)
class MediaFeatureSettings:
    """Extra media capabilities toggled on :class:`pj.MediaConfig`."""

    enable_ice: bool = False
    enable_rtcp_mux: bool = True
    no_vad: bool = True
    ice_no_host_cands: bool | None = True
    ec_tail_len: int | None = 0
    srtp_opt: int | None = 1


@dataclass(frozen=True)
class TransportSettings:
    """Transport level configuration."""

    port: int


def logging_settings() -> LoggingSettings:
    """Return the logging configuration applied to the endpoint."""

    return LoggingSettings()


def session_timer_settings() -> SessionTimerSettings:
    """Return aggressive SIP session timer configuration."""

    return SessionTimerSettings()


def jitter_buffer_settings() -> JitterBufferSettings:
    """Return jitter buffer tuning to limit audio delay."""

    return JitterBufferSettings()


def rtp_settings() -> RtpSettings:
    """Return RTP port allocation settings."""

    return RtpSettings()


def media_feature_settings(*, nomadic_mode: bool) -> MediaFeatureSettings:
    """Return media feature toggles depending on the deployment mode."""

    return MediaFeatureSettings(enable_ice=nomadic_mode)


def transport_settings(*, port: int) -> TransportSettings:
    """Return transport configuration for the SIP endpoint."""

    return TransportSettings(port=port)


__all__ = [
    "JitterBufferSettings",
    "LoggingSettings",
    "MediaFeatureSettings",
    "RtpSettings",
    "SessionTimerSettings",
    "TransportSettings",
    "jitter_buffer_settings",
    "logging_settings",
    "media_feature_settings",
    "rtp_settings",
    "session_timer_settings",
    "transport_settings",
]
