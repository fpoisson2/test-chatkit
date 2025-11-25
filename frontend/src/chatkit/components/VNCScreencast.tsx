import React, { useEffect, useRef, useState } from 'react';

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

// Global map to track active WebSocket connections by token
const activeConnections = new Map<string, WebSocket>();

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
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

  useEffect(() => {
    let mounted = true;
    let ws: WebSocket | null = null;

    if (fatalErrorTokens.has(vncToken)) {
      console.log('[VNCScreencast] Token has fatal error, not attempting connection:', vncToken.substring(0, 8));
      return;
    }

    // Close any existing connection for this token
    const existingConnection = activeConnections.get(vncToken);
    if (existingConnection) {
      console.log('[VNCScreencast] Closing existing connection for token:', vncToken.substring(0, 8));
      try {
        existingConnection.close();
      } catch (err) {
        console.error('[VNCScreencast] Error closing existing connection:', err);
      }
      activeConnections.delete(vncToken);
    }

    const connect = async () => {
      if (!mounted || fatalErrorTokens.has(vncToken)) {
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

        // Connect to VNC WebSocket proxy
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const wsUrl = `${protocol}//${host}${info.websocket_path}`;

        console.log('[VNCScreencast] Connecting to VNC WebSocket:', wsUrl);
        ws = new WebSocket(wsUrl, ['binary']);
        wsRef.current = ws;
        activeConnections.set(vncToken, ws);

        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
          if (!mounted) return;
          console.log('[VNCScreencast] VNC WebSocket connected');
          setIsConnected(true);
          setError(null);

          // Initialize canvas with dimensions
          if (canvasRef.current && info.dimensions) {
            canvasRef.current.width = info.dimensions.width;
            canvasRef.current.height = info.dimensions.height;
          }
        };

        ws.onmessage = (event) => {
          if (!mounted) return;

          // Handle VNC frame data (RFB protocol)
          // noVNC sends binary data representing the VNC framebuffer
          if (event.data instanceof ArrayBuffer) {
            handleVNCFrame(event.data);
          }
        };

        ws.onerror = (event) => {
          console.error('[VNCScreencast] WebSocket error:', event);
          setError('Erreur de connexion VNC');
        };

        ws.onclose = () => {
          console.log('[VNCScreencast] WebSocket closed, mounted:', mounted);
          setIsConnected(false);
          wsRef.current = null;

          if (activeConnections.get(vncToken) === ws) {
            activeConnections.delete(vncToken);
          }

          if (!mounted) return;

          if (fatalErrorTokens.has(vncToken)) {
            console.log('[VNCScreencast] Not reconnecting due to fatal error');
            return;
          }

          if (activeConnections.has(vncToken)) {
            console.log('[VNCScreencast] Newer connection exists, not reconnecting');
            return;
          }

          reconnectTimeoutRef.current = setTimeout(() => {
            if (!mounted) return;
            console.log('[VNCScreencast] Attempting reconnection...');
            connect();
          }, 2000);
        };

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

        if (mounted) {
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
      if (onLastFrameRef.current && canvasRef.current) {
        try {
          const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.9);
          onLastFrameRef.current(dataUrl);
        } catch (err) {
          console.error('[VNCScreencast] Error capturing last frame:', err);
        }
      }

      if (ws) {
        if (activeConnections.get(vncToken) === ws) {
          activeConnections.delete(vncToken);
        }
        ws.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vncToken, authToken]);

  const handleVNCFrame = (data: ArrayBuffer) => {
    // Basic RFB frame handling
    // In a real implementation, we would use noVNC's RFB library
    // For now, we'll just draw a placeholder or raw pixels
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // This is a simplified handler - noVNC library handles the complex RFB protocol
    // The actual implementation should use @novnc/novnc library on the frontend
    try {
      // If the data is a raw framebuffer update (simplified)
      const uint8Array = new Uint8Array(data);
      if (uint8Array.length >= 4) {
        // Draw received data as image data if it matches canvas size
        const expectedSize = canvas.width * canvas.height * 4; // RGBA
        if (uint8Array.length === expectedSize) {
          const imageData = new ImageData(
            new Uint8ClampedArray(uint8Array),
            canvas.width,
            canvas.height
          );
          ctx.putImageData(imageData, 0, 0);
        }
      }
    } catch (err) {
      console.error('[VNCScreencast] Error handling VNC frame:', err);
    }
  };

  const sendKeyEvent = (key: string, down: boolean) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // RFB Key Event message (simplified)
    // In production, use noVNC's RFB library
    console.log(`[VNCScreencast] Key ${down ? 'down' : 'up'}: ${key}`);
  };

  const sendPointerEvent = (x: number, y: number, buttons: number) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    // RFB Pointer Event message (simplified)
    console.log(`[VNCScreencast] Pointer: (${x}, ${y}) buttons=${buttons}`);
  };

  const handleMouseEvent = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!enableInput || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.floor((event.clientX - rect.left) * scaleX);
    const y = Math.floor((event.clientY - rect.top) * scaleY);

    let buttons = 0;
    if (event.buttons & 1) buttons |= 1; // Left button
    if (event.buttons & 2) buttons |= 4; // Right button
    if (event.buttons & 4) buttons |= 2; // Middle button

    sendPointerEvent(x, y, buttons);
  };

  const handleKeyEvent = (event: React.KeyboardEvent<HTMLCanvasElement>, down: boolean) => {
    if (!enableInput) return;
    event.preventDefault();
    sendKeyEvent(event.key, down);
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

      <div className="chatkit-screencast-canvas-container">
        <canvas
          ref={canvasRef}
          className="chatkit-screencast-canvas"
          tabIndex={enableInput ? 0 : -1}
          onMouseDown={handleMouseEvent}
          onMouseUp={handleMouseEvent}
          onMouseMove={handleMouseEvent}
          onKeyDown={(e) => handleKeyEvent(e, true)}
          onKeyUp={(e) => handleKeyEvent(e, false)}
        />
      </div>
    </div>
  );
}
