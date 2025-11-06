import { useEffect, useRef, useState, useCallback } from "react";

interface OutboundCallAudioPlayerProps {
  callId: string | null;
  onCallEnd?: () => void;
}

interface AudioPacket {
  type: "audio" | "connected" | "end" | "ping" | "error";
  channel?: "inbound" | "outbound" | "mixed";
  data?: string; // Base64 encoded PCM
  timestamp?: number;
  message?: string;
  call_id?: string;
}

export const OutboundCallAudioPlayer = ({
  callId,
  onCallEnd,
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
  const nextPlayTimeRef = useRef<number>(0);

  // Handle hang up
  const handleHangup = useCallback(async () => {
    if (!callId || isHangingUp) return;

    setIsHangingUp(true);
    try {
      console.log("[OutboundCallAudioPlayer] Sending hangup request for call", callId);

      // Use HTTP POST instead of WebSocket for reliability
      const response = await fetch(`/api/outbound/call/${callId}/hangup`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
  }, [callId, isHangingUp, onCallEnd]);

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
  const playAudioChunk = useCallback((pcmData: Uint8Array) => {
    if (!audioContextRef.current || !gainNodeRef.current) {
      initializeAudioContext();
      if (!audioContextRef.current || !gainNodeRef.current) return;
    }

    const audioContext = audioContextRef.current;
    const gainNode = gainNodeRef.current;

    // Convert PCM16 to Float32
    const float32Array = new Float32Array(pcmData.length / 2);
    for (let i = 0; i < float32Array.length; i++) {
      const int16 = (pcmData[i * 2 + 1] << 8) | pcmData[i * 2];
      float32Array[i] = int16 < 0x8000 ? int16 / 0x8000 : (int16 - 0x10000) / 0x8000;
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
    const startTime = Math.max(now, nextPlayTimeRef.current);
    source.start(startTime);

    // Update next play time
    nextPlayTimeRef.current = startTime + audioBuffer.duration;

    // Clean up after playback
    source.onended = () => {
      const index = audioQueueRef.current.indexOf(source);
      if (index > -1) {
        audioQueueRef.current.splice(index, 1);
      }
    };

    audioQueueRef.current.push(source);
  }, [initializeAudioContext]);

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

    ws.onopen = () => {
      console.log("[OutboundCallAudioPlayer] WebSocket connected");
      setIsConnected(true);
      setError(null);
      initializeAudioContext();
    };

    ws.onmessage = (event) => {
      try {
        const packet: AudioPacket = JSON.parse(event.data);

        switch (packet.type) {
          case "connected":
            console.log("[OutboundCallAudioPlayer] Stream connected:", packet.message);
            break;

          case "audio":
            if (isMuted) break;

            // Filter by channel if needed
            if (channelFilter !== "all" && packet.channel !== channelFilter) {
              break;
            }

            // Decode base64 PCM data
            if (packet.data) {
              const binaryString = atob(packet.data);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              playAudioChunk(bytes);
            }
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
            console.warn("[OutboundCallAudioPlayer] Unknown packet type:", packet.type);
        }
      } catch (err) {
        console.error("[OutboundCallAudioPlayer] Failed to process message:", err);
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
              animation: isConnected ? "pulse 1.5s infinite" : "none",
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
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
};
