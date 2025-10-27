import { useCallback, useEffect, useRef } from "react";

const DEFAULT_OFFER_ENDPOINT = "/api/chatkit/voice/webrtc/offer";
const DEFAULT_TEARDOWN_ENDPOINT = "/api/chatkit/voice/webrtc/teardown";

export type RealtimeConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected";

export type RealtimeSessionHandlers = {
  onHistoryUpdated?: (history: unknown[]) => void;
  onConnectionChange?: (status: RealtimeConnectionStatus) => void;
  onTransportError?: (error: unknown) => void;
  onAgentStart?: () => void;
  onAgentEnd?: () => void;
  onError?: (error: unknown) => void;
};

export type ConnectOptions = {
  token: string;
  localStream: MediaStream;
  offerEndpoint?: string;
  teardownEndpoint?: string;
};

type GatewayTranscripts = {
  id: string;
  role: "user" | "assistant";
  text: string;
  status?: string;
}[];

type OfferResponse = {
  session_id: string;
  answer: RTCSessionDescriptionInit;
  expires_at?: string | null;
};

type TeardownResponse = {
  session_id: string;
  transcripts?: GatewayTranscripts;
  error?: string | null;
};

const waitForIceCompletion = (pc: RTCPeerConnection): Promise<void> =>
  new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") {
      resolve();
      return;
    }
    const checkState = () => {
      if (pc.iceGatheringState === "complete") {
        pc.removeEventListener("icegatheringstatechange", checkState);
        resolve();
      }
    };
    pc.addEventListener("icegatheringstatechange", checkState);
  });

const convertTranscriptsToHistory = (transcripts: GatewayTranscripts) => {
  return transcripts.map((entry) => ({
    type: "message",
    itemId: entry.id,
    role: entry.role,
    status: entry.status ?? "completed",
    content: [
      {
        type: entry.role === "assistant" ? "output_text" : "input_text",
        text: entry.text,
      },
    ],
  }));
};

const createRemoteAudioElement = () => {
  if (typeof window === "undefined") {
    return null;
  }
  const element = document.createElement("audio");
  element.autoplay = true;
  element.controls = false;
  element.playsInline = true;
  element.muted = false;
  element.style.display = "none";
  document.body.appendChild(element);
  return element;
};

const destroyRemoteAudioElement = (element: HTMLAudioElement | null) => {
  if (!element) {
    return;
  }
  try {
    element.pause();
  } catch {
    /* noop */
  }
  if (element.srcObject instanceof MediaStream) {
    element.srcObject.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* noop */
      }
    });
  }
  element.srcObject = null;
  if (element.parentNode) {
    element.parentNode.removeChild(element);
  }
};

const buildHeaders = (token: string) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${token}`,
});

export const useRealtimeSession = (
  handlers: RealtimeSessionHandlers,
) => {
  const handlersRef = useRef(handlers);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const offerEndpointRef = useRef<string>(DEFAULT_OFFER_ENDPOINT);
  const teardownEndpointRef = useRef<string>(DEFAULT_TEARDOWN_ENDPOINT);
  const disconnectingRef = useRef(false);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const cleanupLocalStream = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) {
      return;
    }
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* noop */
      }
    });
    localStreamRef.current = null;
  }, []);

  const cleanupRemote = useCallback(() => {
    destroyRemoteAudioElement(remoteAudioRef.current);
    remoteAudioRef.current = null;
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* noop */
        }
      });
      remoteStreamRef.current = null;
    }
  }, []);

  const notifyConnection = useCallback((status: RealtimeConnectionStatus) => {
    handlersRef.current.onConnectionChange?.(status);
  }, []);

  const disconnect = useCallback(() => {
    if (disconnectingRef.current) {
      return;
    }
    disconnectingRef.current = true;

    void (async () => {
      const pc = pcRef.current;
      pcRef.current = null;
      if (pc) {
        try {
          pc.ontrack = null;
          pc.oniceconnectionstatechange = null;
          pc.onconnectionstatechange = null;
          await pc.close();
        } catch {
          /* noop */
        }
      }

      const sessionId = sessionIdRef.current;
      const token = tokenRef.current;
      const teardownEndpoint = teardownEndpointRef.current;
      sessionIdRef.current = null;

      cleanupLocalStream();
      cleanupRemote();
      notifyConnection("disconnected");
      handlersRef.current.onAgentEnd?.();

      if (sessionId && token) {
        try {
          const response = await fetch(teardownEndpoint, {
            method: "POST",
            headers: buildHeaders(token),
            body: JSON.stringify({ session_id: sessionId }),
          });
          if (response.ok) {
            const payload = (await response.json()) as TeardownResponse;
            const transcripts = Array.isArray(payload.transcripts)
              ? payload.transcripts
              : [];
            if (transcripts.length > 0) {
              handlersRef.current.onHistoryUpdated?.(
                convertTranscriptsToHistory(transcripts),
              );
            }
            if (payload.error) {
              handlersRef.current.onError?.(payload.error);
            }
          } else {
            handlersRef.current.onTransportError?.(
              new Error(
                `Échec de la fermeture de la session WebRTC (HTTP ${response.status}).`,
              ),
            );
          }
        } catch (error) {
          handlersRef.current.onTransportError?.(error);
        }
      }

      disconnectingRef.current = false;
    })();
  }, [cleanupLocalStream, cleanupRemote, notifyConnection]);

  useEffect(() => () => {
    disconnect();
  }, [disconnect]);

  const connect = useCallback(
    async ({
      token,
      localStream,
      offerEndpoint = DEFAULT_OFFER_ENDPOINT,
      teardownEndpoint = DEFAULT_TEARDOWN_ENDPOINT,
    }: ConnectOptions) => {
      disconnect();

      tokenRef.current = token;
      offerEndpointRef.current = offerEndpoint;
      teardownEndpointRef.current = teardownEndpoint;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      sessionIdRef.current = null;
      localStreamRef.current = localStream;
      notifyConnection("connecting");

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;
      const audioElement = createRemoteAudioElement();
      if (audioElement) {
        audioElement.srcObject = remoteStream;
        remoteAudioRef.current = audioElement;
        audioElement.play().catch(() => {
          try {
            audioElement.muted = true;
            audioElement.play().catch(() => {
              /* noop */
            });
          } catch {
            /* noop */
          }
        });
      }

      pc.addEventListener("track", (event) => {
        event.streams.forEach((stream) => {
          stream.getAudioTracks().forEach((track) => {
            remoteStream.addTrack(track);
            track.onunmute = () => {
              handlersRef.current.onAgentStart?.();
            };
            track.onmute = () => {
              handlersRef.current.onAgentEnd?.();
            };
            track.onended = () => {
              handlersRef.current.onAgentEnd?.();
            };
          });
        });
      });

      pc.addEventListener("iceconnectionstatechange", () => {
        const state = pc.iceConnectionState;
        if (state === "failed") {
          handlersRef.current.onTransportError?.(
            new Error("Connexion WebRTC échouée"),
          );
          disconnect();
        } else if (state === "connected") {
          notifyConnection("connected");
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "connected") {
          notifyConnection("connected");
        } else if (pc.connectionState === "disconnected") {
          disconnect();
        }
      });

      try {
        const offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        await waitForIceCompletion(pc);

        const localDescription = pc.localDescription;
        if (!localDescription) {
          throw new Error("Impossible de générer une offre WebRTC valide.");
        }

        const response = await fetch(offerEndpoint, {
          method: "POST",
          headers: buildHeaders(token),
          body: JSON.stringify({ offer: localDescription }),
        });
        if (!response.ok) {
          throw new Error(
            `Échec de la création de la session WebRTC (HTTP ${response.status}).`,
          );
        }

        const payload = (await response.json()) as OfferResponse;
        sessionIdRef.current = payload.session_id;

        const answer = payload.answer;
        if (!answer?.sdp) {
          throw new Error("Réponse WebRTC invalide renvoyée par le serveur.");
        }
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        notifyConnection("connected");
      } catch (error) {
        handlersRef.current.onError?.(error);
        cleanupLocalStream();
        disconnect();
        throw error;
      }
    },
    [cleanupLocalStream, disconnect, notifyConnection],
  );

  return {
    connect,
    disconnect,
  };
};

export type { GatewayTranscripts };

