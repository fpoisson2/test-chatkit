import { useEffect, useRef, useState, useCallback } from "react";

interface OutboundCallAudioPlayerProps {
  callId: string | null;
  onCallEnd?: () => void;
  authToken: string | null;
}

type AudioChannel = "inbound" | "outbound" | "mixed";

interface ControlPacket {
  type: "connected" | "end" | "ping" | "error";
  message?: string;
  call_id?: string;
}

export const OutboundCallAudioPlayer = ({
  callId,
  onCallEnd,
  authToken,
}: OutboundCallAudioPlayerProps) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [channelFilter, setChannelFilter] = useState<"all" | "inbound" | "outbound">("all");
  const [error, setError] = useState<string | null>(null);
  const [isHangingUp, setIsHangingUp] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const audioQueueRef = useRef<AudioBufferSourceNode[]>([]);
  const nextPlayTimeRefs = useRef<Record<string, number>>({
    default: 0,
    inbound: 0,
    outbound: 0,
    mixed: 0,
  });

  // Handle hang up
  const handleHangup = useCallback(async () => {
    if (!callId || isHangingUp || !authToken) {
      console.error("[OutboundCallAudioPlayer] Cannot hangup:", { callId, isHangingUp, hasToken: !!authToken });
      if (!authToken) {
        setError("Token d'authentification manquant");
      }
      return;
    }

    setIsHangingUp(true);
    try {
      console.log("[OutboundCallAudioPlayer] Sending hangup request for call", callId);

      // Use HTTP POST instead of WebSocket for reliability
      const response = await fetch(`/api/outbound/call/${callId}/hangup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: "Erreur inconnue" }));
        throw new Error(errorData.detail || `HTTP ${response.status}`);
      }

      console.log("[OutboundCallAudioPlayer] Call hung up successfully");
      setIsHangingUp(false);
      onCallEnd?.();
    } catch (err) {
      console.error("[OutboundCallAudioPlayer] Failed to hang up call:", err);
      setError(`Échec du raccrochage: ${err instanceof Error ? err.message : String(err)}`);
      setIsHangingUp(false);
    }
  }, [callId, isHangingUp, onCallEnd, authToken]);

  // Initialize Audio Context
  const initializeAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 24000,
      });
      gainNodeRef.current = audioContextRef.current.createGain();
      gainNodeRef.current.connect(audioContextRef.current.destination);
      gainNodeRef.current.gain.value = volume;
    }
  }, [volume]);

  // Play audio chunk
  const playAudioChunk = useCallback(
    (pcmData: Int16Array, channel: AudioChannel | undefined) => {
      if (!audioContextRef.current || !gainNodeRef.current) {
        initializeAudioContext();
        if (!audioContextRef.current || !gainNodeRef.current) return;
      }

      const audioContext = audioContextRef.current;
      const gainNode = gainNodeRef.current;

      const channelKey = channel ?? "default";
      if (!(channelKey in nextPlayTimeRefs.current)) {
        nextPlayTimeRefs.current[channelKey] = 0;
      }

      // Convert PCM16 to Float32
      const float32Array = new Float32Array(pcmData.length);
      for (let i = 0; i < float32Array.length; i++) {
        float32Array[i] = Math.max(-1, Math.min(1, pcmData[i] / 0x8000));
      }

      // Create audio buffer
      const audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000);
      audioBuffer.getChannelData(0).set(float32Array);

      // Create source node
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);

      // Schedule playback
      const now = audioContext.currentTime;
      const startTime = Math.max(now, nextPlayTimeRefs.current[channelKey]);
      source.start(startTime);

      // Update next play time
      nextPlayTimeRefs.current[channelKey] =
        startTime + audioBuffer.duration;

      // Clean up after playback
      source.onended = () => {
        const index = audioQueueRef.current.indexOf(source);
        if (index > -1) {
          audioQueueRef.current.splice(index, 1);
        }
      };

      audioQueueRef.current.push(source);
    },
    [initializeAudioContext]
  );

  // Connect to WebSocket
  useEffect(() => {
    if (!callId) {
      return;
    }

    // Construct WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/outbound/call/${callId}/audio/stream`;

    console.log("[OutboundCallAudioPlayer] Connecting to", wsUrl);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    const decodeChannel = (code: number): AudioChannel | undefined => {
      switch (code) {
        case 1:
          return "inbound";
        case 2:
          return "outbound";
        case 3:
          return "mixed";
        default:
          return undefined;
      }
    };

    const handleAudioFrame = (buffer: ArrayBuffer) => {
      if (buffer.byteLength <= 2) {
        return;
      }

      const view = new DataView(buffer);
      const channel = decodeChannel(view.getUint8(0));

      if (isMuted) {
        return;
      }

      if (channelFilter !== "all" && channel !== channelFilter) {
        return;
      }

      const audioSlice = buffer.slice(2);
      if (audioSlice.byteLength === 0) {
        return;
      }

      const pcm16 = new Int16Array(audioSlice);
      playAudioChunk(pcm16, channel);
    };

    ws.onopen = () => {
      console.log("[OutboundCallAudioPlayer] WebSocket connected");
      setIsConnected(true);
      setError(null);
      initializeAudioContext();
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const packet: ControlPacket = JSON.parse(event.data);

          switch (packet.type) {
            case "connected":
              console.log("[OutboundCallAudioPlayer] Stream connected:", packet.message);
              break;

            case "end":
              console.log("[OutboundCallAudioPlayer] Call ended");
              onCallEnd?.();
              break;

            case "ping":
              // Keep-alive
              break;

            case "error":
              console.error("[OutboundCallAudioPlayer] Error:", packet.message);
              setError(packet.message || "Une erreur s'est produite");
              break;

            default:
              console.warn("[OutboundCallAudioPlayer] Unknown control packet type:", packet.type);
          }
        } catch (err) {
          console.error("[OutboundCallAudioPlayer] Failed to process control message:", err);
        }
        return;
      }

      if (event.data instanceof ArrayBuffer) {
        handleAudioFrame(event.data);
        return;
      }

      if (event.data instanceof Blob) {
        event.data
          .arrayBuffer()
          .then(handleAudioFrame)
          .catch((err) => {
            console.error("[OutboundCallAudioPlayer] Failed to read audio blob:", err);
          });
        return;
      }
    };

    ws.onerror = (error) => {
      console.error("[OutboundCallAudioPlayer] WebSocket error:", error);
      setError("Erreur de connexion audio");
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log("[OutboundCallAudioPlayer] WebSocket closed");
      setIsConnected(false);
    };

    return () => {
      // Cleanup
      ws.close();
      wsRef.current = null;

      // Stop all playing audio
      audioQueueRef.current.forEach((source) => {
        try {
          source.stop();
        } catch (e) {
          // Ignore if already stopped
        }
      });
      audioQueueRef.current = [];
      nextPlayTimeRefs.current = { default: 0, inbound: 0, outbound: 0, mixed: 0 };

      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
        gainNodeRef.current = null;
      }
    };
  }, [callId, channelFilter, isMuted, initializeAudioContext, onCallEnd, playAudioChunk]);

  // Update volume
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  if (!callId) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        padding: "16px",
        background: isConnected ? "#10a37f" : "#ff9800",
        color: "white",
        borderRadius: "12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
        fontSize: "14px",
        fontWeight: 500,
        zIndex: 1000,
        minWidth: "300px",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: "white",
              animation: isConnected ? "chatkit-outbound-call-pulse 1.5s infinite" : "none",
            }}
          />
          <span style={{ fontWeight: 600 }}>
            {isConnected ? "🎧 Appel en cours" : "⏸️ Connexion..."}
          </span>
        </div>
        <button
          type="button"
          onClick={handleHangup}
          disabled={isHangingUp}
          style={{
            padding: "6px 12px",
            background: "#dc2626",
            border: "none",
            borderRadius: "6px",
            color: "white",
            cursor: isHangingUp ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: 600,
            opacity: isHangingUp ? 0.6 : 1,
            display: "flex",
            alignItems: "center",
            gap: "4px",
          }}
        >
          📞 {isHangingUp ? "Raccrochage..." : "Raccrocher"}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            background: "rgba(255,255,255,0.2)",
            padding: "8px",
            borderRadius: "6px",
            marginBottom: "12px",
            fontSize: "12px",
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {/* Volume control */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            style={{
              padding: "6px 12px",
              background: "rgba(255,255,255,0.2)",
              border: "none",
              borderRadius: "6px",
              color: "white",
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: 500,
            }}
          >
            {isMuted ? "🔇 Muet" : "🔊 Son"}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            disabled={isMuted}
            style={{
              flex: 1,
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: "12px", minWidth: "35px" }}>
            {Math.round(volume * 100)}%
          </span>
        </div>

        {/* Channel filter */}
        <div style={{ display: "flex", gap: "4px" }}>
          {(["all", "inbound", "outbound"] as const).map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => setChannelFilter(ch)}
              style={{
                padding: "4px 8px",
                background:
                  channelFilter === ch
                    ? "rgba(255,255,255,0.3)"
                    : "rgba(255,255,255,0.1)",
                border: "none",
                borderRadius: "4px",
                color: "white",
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 500,
                flex: 1,
              }}
            >
              {ch === "all" ? "🎧 Tout" : ch === "inbound" ? "🎤 Entrant" : "🔊 Sortant"}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes chatkit-outbound-call-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
};
