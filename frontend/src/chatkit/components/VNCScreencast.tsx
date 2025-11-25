import React, { useEffect, useRef, useState, useCallback } from 'react';
import { VncScreen, VncScreenHandle } from 'react-vnc';

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
  const vncRef = useRef<VncScreenHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    fatalErrorTokens.has(vncToken) ? 'Token invalide ou expire' : null
  );
  const [vncInfo, setVncInfo] = useState<{
    vnc_host: string;
    vnc_port: number;
    websocket_path: string;
    dimensions: { width: number; height: number };
  } | null>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const onLastFrameRef = useRef(onLastFrame);

  useEffect(() => {
    onLastFrameRef.current = onLastFrame;
  }, [onLastFrame]);

  // Capture last frame from the canvas
  const captureLastFrame = useCallback(() => {
    if (!onLastFrameRef.current) return;

    // react-vnc creates a canvas inside the container
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

  // Fetch VNC info on mount
  useEffect(() => {
    let mounted = true;

    if (fatalErrorTokens.has(vncToken)) {
      console.log('[VNCScreencast] Token has fatal error, not attempting connection:', vncToken.substring(0, 8));
      return;
    }

    const fetchVncInfo = async () => {
      try {
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
          return;
        }

        const info = await response.json();
        console.log('[VNCScreencast] VNC info:', info);

        if (!mounted) return;

        setVncInfo(info);

        // Build WebSocket URL for VNC
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const url = `${protocol}//${host}${info.websocket_path}`;
        console.log('[VNCScreencast] WebSocket URL:', url);
        setWsUrl(url);

      } catch (err) {
        console.error('[VNCScreencast] Error fetching VNC info:', err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(`Echec de connexion: ${errorMessage}`);
        if (onConnectionError) {
          onConnectionError();
        }
      }
    };

    fetchVncInfo();

    return () => {
      mounted = false;
      // Capture last frame before unmounting
      captureLastFrame();
    };
  }, [vncToken, authToken, onConnectionError, captureLastFrame]);

  // Handle Ctrl+Alt+Del
  const sendCtrlAltDel = () => {
    if (vncRef.current && isConnected) {
      vncRef.current.sendCtrlAltDel();
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

  // Connection handlers
  const handleConnect = useCallback(() => {
    console.log('[VNCScreencast] Connected');
    setIsConnected(true);
    setError(null);
  }, []);

  const handleDisconnect = useCallback((e?: { detail: { clean: boolean } }) => {
    console.log('[VNCScreencast] Disconnected:', e?.detail);
    setIsConnected(false);

    if (e?.detail?.clean === false) {
      setError('Connexion VNC perdue');
    }
  }, []);

  const handleSecurityFailure = useCallback((e?: { detail: { reason?: string } }) => {
    console.error('[VNCScreencast] Security failure:', e?.detail);
    const errorMsg = `Echec d'authentification VNC: ${e?.detail?.reason || 'Unknown'}`;
    setError(errorMsg);
    fatalErrorTokens.add(vncToken);
    if (onConnectionError) {
      onConnectionError();
    }
  }, [vncToken, onConnectionError]);

  const handleCredentialsRequired = useCallback(() => {
    console.log('[VNCScreencast] Credentials required');
    setError('Authentification VNC requise');
  }, []);

  return (
    <div className={`chatkit-vnc-screencast ${className}`} ref={containerRef}>
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
              {wsUrl ? 'Connexion...' : 'Chargement...'}
            </span>
          )}
        </div>
      </div>

      <div
        className="chatkit-vnc-canvas-container"
        style={{
          width: '100%',
          height: vncInfo?.dimensions ? `${Math.min(vncInfo.dimensions.height, 600)}px` : '400px',
          backgroundColor: '#1a1a1a',
        }}
      >
        {wsUrl && (
          <VncScreen
            url={wsUrl}
            ref={vncRef}
            scaleViewport
            viewOnly={!enableInput}
            showDotCursor={enableInput}
            background="#1a1a1a"
            style={{
              width: '100%',
              height: '100%',
            }}
            retryDuration={3000}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onSecurityFailure={handleSecurityFailure}
            onCredentialsRequired={handleCredentialsRequired}
          />
        )}
      </div>
    </div>
  );
}
