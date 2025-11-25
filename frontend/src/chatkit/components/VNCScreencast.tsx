import React, { useEffect, useRef, useState, useCallback } from 'react';
import RFB from '@novnc/novnc/core/rfb';

interface VNCScreencastProps {
  vncToken: string;
  authToken?: string;
  className?: string;
  onConnectionError?: () => void;
  onLastFrame?: (frameDataUrl: string) => void;
  enableInput?: boolean;
}

// Global map to track tokens that have fatal errors
const fatalErrorTokens = new Set<string>();

// Global map to track active RFB connections by token
const activeConnections = new Map<string, RFB>();

export function clearFatalErrorForToken(token: string): void {
  fatalErrorTokens.delete(token);
}

export function VNCScreencast({
  vncToken,
  authToken,
  className = '',
  enableInput = false,
  onConnectionError,
  onLastFrame,
}: VNCScreencastProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    fatalErrorTokens.has(vncToken) ? 'Token invalide ou expire' : null
  );
  const [vncInfo, setVncInfo] = useState<{
    vnc_host: string;
    vnc_port: number;
    dimensions: { width: number; height: number };
  } | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onLastFrameRef = useRef(onLastFrame);

  useEffect(() => {
    onLastFrameRef.current = onLastFrame;
  }, [onLastFrame]);

  // Capture last frame from the canvas
  const captureLastFrame = useCallback(() => {
    if (!onLastFrameRef.current) return;

    // noVNC creates a canvas inside the container
    const canvas = containerRef.current?.querySelector('canvas');
    if (canvas) {
      try {
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        onLastFrameRef.current(dataUrl);
        console.log('[VNCScreencast] Captured last frame before closing');
      } catch (err) {
        console.error('[VNCScreencast] Error capturing last frame:', err);
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let rfb: RFB | null = null;

    if (fatalErrorTokens.has(vncToken)) {
      console.log('[VNCScreencast] Token has fatal error, not attempting connection:', vncToken.substring(0, 8));
      return;
    }

    // Close any existing connection for this token
    const existingConnection = activeConnections.get(vncToken);
    if (existingConnection) {
      console.log('[VNCScreencast] Closing existing connection for token:', vncToken.substring(0, 8));
      try {
        existingConnection.disconnect();
      } catch (err) {
        console.error('[VNCScreencast] Error closing existing connection:', err);
      }
      activeConnections.delete(vncToken);
    }

    const connect = async () => {
      if (!mounted || fatalErrorTokens.has(vncToken) || !containerRef.current) {
        return;
      }

      try {
        // First, fetch VNC session info
        console.log('[VNCScreencast] Fetching VNC info...');

        const infoUrl = `/api/computer/vnc/info/${encodeURIComponent(vncToken)}`;
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };

        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(infoUrl, {
          credentials: 'include',
          headers,
        });

        if (!response.ok) {
          const errorMsg = `Failed to fetch VNC info: ${response.status} ${response.statusText}`;
          setError(errorMsg);
          if (response.status === 403 || response.status === 404) {
            fatalErrorTokens.add(vncToken);
          }
          if (onConnectionError) {
            onConnectionError();
          }
          throw new Error(errorMsg);
        }

        const info = await response.json();
        console.log('[VNCScreencast] VNC info:', info);
        setVncInfo(info);

        // Build WebSocket URL for noVNC
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}${info.websocket_path}`;

        console.log('[VNCScreencast] Connecting to VNC via noVNC:', wsUrl);

        // Clear the container before creating a new RFB connection
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }

        // Create noVNC RFB connection
        rfb = new RFB(containerRef.current, wsUrl, {
          credentials: { password: '' }, // Password handled by backend
          wsProtocols: ['binary'],
        });

        rfbRef.current = rfb;
        activeConnections.set(vncToken, rfb);

        // Configure RFB options
        rfb.viewOnly = !enableInput;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.showDotCursor = enableInput;

        // Event handlers
        rfb.addEventListener('connect', () => {
          if (!mounted) return;
          console.log('[VNCScreencast] noVNC connected');
          setIsConnected(true);
          setError(null);
        });

        rfb.addEventListener('disconnect', (event: CustomEvent) => {
          console.log('[VNCScreencast] noVNC disconnected:', event.detail);
          setIsConnected(false);

          if (activeConnections.get(vncToken) === rfb) {
            activeConnections.delete(vncToken);
          }

          if (!mounted) return;

          // Check if it was a clean disconnect or an error
          if (event.detail.clean === false) {
            const errorMsg = 'Connexion VNC perdue';
            setError(errorMsg);

            if (!fatalErrorTokens.has(vncToken) && !activeConnections.has(vncToken)) {
              // Attempt reconnection after 2 seconds
              reconnectTimeoutRef.current = setTimeout(() => {
                if (!mounted) return;
                console.log('[VNCScreencast] Attempting reconnection...');
                connect();
              }, 2000);
            }
          }
        });

        rfb.addEventListener('securityfailure', (event: CustomEvent) => {
          console.error('[VNCScreencast] Security failure:', event.detail);
          const errorMsg = `Echec d'authentification VNC: ${event.detail.reason || 'Unknown'}`;
          setError(errorMsg);
          fatalErrorTokens.add(vncToken);
          if (onConnectionError) {
            onConnectionError();
          }
        });

        rfb.addEventListener('credentialsrequired', () => {
          console.log('[VNCScreencast] Credentials required');
          // The password is handled by the backend (websockify)
          // If we get here, it means the VNC server requires auth that wasn't provided
          setError('Authentification VNC requise');
        });

        rfb.addEventListener('desktopname', (event: CustomEvent) => {
          console.log('[VNCScreencast] Desktop name:', event.detail.name);
        });

      } catch (err) {
        console.error('[VNCScreencast] Connection error:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(`Echec de connexion: ${errorMessage}`);

        if (errorMessage.includes('403') || errorMessage.includes('404')) {
          fatalErrorTokens.add(vncToken);
          if (onConnectionError) {
            onConnectionError();
          }
          return;
        }

        if (mounted && !fatalErrorTokens.has(vncToken)) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[VNCScreencast] Retrying connection...');
            connect();
          }, 3000);
        }
      }
    };

    connect();

    return () => {
      mounted = false;
      console.log('[VNCScreencast] Cleanup: unmounting component for token:', vncToken.substring(0, 8));

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      // Capture last frame before closing
      captureLastFrame();

      if (rfb) {
        if (activeConnections.get(vncToken) === rfb) {
          activeConnections.delete(vncToken);
        }
        try {
          rfb.disconnect();
        } catch (err) {
          console.error('[VNCScreencast] Error disconnecting RFB:', err);
        }
        rfbRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vncToken, authToken, enableInput, captureLastFrame]);

  // Handle Ctrl+Alt+Del
  const sendCtrlAltDel = () => {
    if (rfbRef.current && isConnected) {
      rfbRef.current.sendCtrlAltDel();
    }
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (containerRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    }
  };

  return (
    <div className={`chatkit-vnc-screencast ${className}`}>
      {error && (
        <div className="chatkit-screencast-error">
          {error}
        </div>
      )}

      <div className="chatkit-vnc-toolbar">
        <div className="chatkit-vnc-info">
          {vncInfo && (
            <span className="chatkit-vnc-host">
              VNC: {vncInfo.vnc_host}:{vncInfo.vnc_port}
            </span>
          )}
        </div>

        <div className="chatkit-vnc-controls">
          {enableInput && (
            <button
              type="button"
              onClick={sendCtrlAltDel}
              disabled={!isConnected}
              className="chatkit-vnc-button"
              title="Ctrl+Alt+Del"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="4" width="12" height="8" rx="1" />
                <path d="M5 7h6M8 7v3" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            disabled={!isConnected}
            className="chatkit-vnc-button"
            title="Plein ecran"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2 5V3a1 1 0 011-1h2M11 2h2a1 1 0 011 1v2M14 11v2a1 1 0 01-1 1h-2M5 14H3a1 1 0 01-1-1v-2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="chatkit-vnc-status">
          {isConnected ? (
            <span className="chatkit-status-badge chatkit-status-live" title="Connecte">
              Live
            </span>
          ) : (
            <span className="chatkit-status-badge chatkit-status-connecting">
              Connexion...
            </span>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="chatkit-vnc-canvas-container"
        style={{
          width: '100%',
          height: vncInfo?.dimensions ? `${Math.min(vncInfo.dimensions.height, 600)}px` : '400px',
          backgroundColor: '#1a1a1a',
        }}
      />
    </div>
  );
}
