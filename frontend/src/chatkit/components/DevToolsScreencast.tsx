import React, { useEffect, useRef, useState } from 'react';

interface DevToolsScreencastProps {
  debugUrlToken: string;
  authToken?: string; // JWT token for authentication
  className?: string;
  onConnectionError?: () => void; // Callback when connection fails
}

interface ScreencastFrame {
  sessionId: number;
  data: string; // base64 encoded JPEG
  metadata: {
    timestamp: number;
    deviceWidth: number;
    deviceHeight: number;
  };
}

export function DevToolsScreencast({ debugUrlToken, authToken, className = '', onConnectionError }: DevToolsScreencastProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageIdRef = useRef(1);

  useEffect(() => {
    let mounted = true;
    let ws: WebSocket | null = null;

    const connect = async () => {
      try {
        // Fetch Chrome DevTools targets via our backend proxy
        console.log('[DevToolsScreencast] Fetching targets via proxy...');

        const jsonUrl = `/api/computer/cdp/json?token=${encodeURIComponent(debugUrlToken)}`;
        const headers: HeadersInit = {
          'Content-Type': 'application/json',
        };

        // Add JWT auth token if provided
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }

        const response = await fetch(jsonUrl, {
          credentials: 'include', // Include auth cookies
          headers,
        });
        if (!response.ok) {
          const errorMsg = `Failed to fetch debug info: ${response.status} ${response.statusText}`;
          setError(errorMsg);
          if (onConnectionError) {
            onConnectionError();
          }
          throw new Error(errorMsg);
        }

        const targets = await response.json();
        console.log('[DevToolsScreencast] Available targets:', targets);

        // Find the first page target
        const pageTarget = Array.isArray(targets)
          ? targets.find((t: any) => t.type === 'page')
          : null;

        if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
          setError('No page target with WebSocket URL found');
          return;
        }

        // The WebSocket URL is already rewritten by the backend to point to our proxy
        // Format: /api/computer/cdp/ws?token=XXX&target=/devtools/page/ABC123
        let wsUrl = pageTarget.webSocketDebuggerUrl;

        // Convert to full WebSocket URL (ws:// or wss://)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        wsUrl = `${protocol}//${host}${wsUrl}`;

        console.log('[DevToolsScreencast] Connecting to proxy WebSocket:', wsUrl);
        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          if (!mounted) return;
          console.log('[DevToolsScreencast] WebSocket connected');
          setIsConnected(true);
          setError(null);

          // Start screencast with CDP command
          const startScreencastCommand = {
            id: messageIdRef.current++,
            method: 'Page.startScreencast',
            params: {
              format: 'jpeg',
              quality: 80,
              maxWidth: 1280,
              maxHeight: 720,
              everyNthFrame: 1,
            },
          };
          ws?.send(JSON.stringify(startScreencastCommand));
          console.log('[DevToolsScreencast] Sent Page.startScreencast');
        };

        ws.onmessage = (event) => {
          if (!mounted) return;

          try {
            const message = JSON.parse(event.data);

            // Handle screencast frame
            if (message.method === 'Page.screencastFrame') {
              const frameData: ScreencastFrame = message.params;

              // Draw frame to canvas
              if (canvasRef.current && frameData.data) {
                const img = new Image();
                img.onload = () => {
                  const canvas = canvasRef.current;
                  if (!canvas) return;

                  const ctx = canvas.getContext('2d');
                  if (!ctx) return;

                  // Resize canvas if needed
                  if (canvas.width !== img.width || canvas.height !== img.height) {
                    canvas.width = img.width;
                    canvas.height = img.height;
                  }

                  ctx.drawImage(img, 0, 0);
                  setFrameCount((prev) => prev + 1);
                };
                img.src = `data:image/jpeg;base64,${frameData.data}`;
              }

              // Acknowledge frame
              const ackCommand = {
                id: messageIdRef.current++,
                method: 'Page.screencastFrameAck',
                params: {
                  sessionId: frameData.sessionId,
                },
              };
              ws?.send(JSON.stringify(ackCommand));
            }
          } catch (err) {
            console.error('[DevToolsScreencast] Error processing message:', err);
          }
        };

        ws.onerror = (event) => {
          console.error('[DevToolsScreencast] WebSocket error:', event);
          setError('Connection error');
        };

        ws.onclose = () => {
          if (!mounted) return;
          console.log('[DevToolsScreencast] WebSocket closed');
          setIsConnected(false);
          wsRef.current = null;

          // Attempt reconnection after 2 seconds
          if (mounted) {
            reconnectTimeoutRef.current = setTimeout(() => {
              console.log('[DevToolsScreencast] Attempting reconnection...');
              connect();
            }, 2000);
          }
        };
      } catch (err) {
        console.error('[DevToolsScreencast] Connection error:', err);
        setError(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);

        // Retry on error
        if (mounted) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('[DevToolsScreencast] Retrying connection...');
            connect();
          }, 3000);
        }
      }
    };

    connect();

    return () => {
      mounted = false;

      // Stop screencast before closing
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          const stopScreencastCommand = {
            id: messageIdRef.current++,
            method: 'Page.stopScreencast',
          };
          ws.send(JSON.stringify(stopScreencastCommand));
        } catch (err) {
          console.error('[DevToolsScreencast] Error stopping screencast:', err);
        }
      }

      // Close WebSocket
      if (ws) {
        ws.close();
      }

      // Clear reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [debugUrlToken, authToken]);

  return (
    <div className={`chatkit-devtools-screencast ${className}`}>
      <div className="chatkit-screencast-header">
        <span className="chatkit-screencast-status">
          {isConnected ? (
            <>
              <span className="chatkit-status-indicator chatkit-status-connected">●</span>
              Live ({frameCount} frames)
            </>
          ) : (
            <>
              <span className="chatkit-status-indicator chatkit-status-disconnected">●</span>
              Connecting...
            </>
          )}
        </span>
      </div>

      {error && (
        <div className="chatkit-screencast-error">
          ⚠️ {error}
        </div>
      )}

      <div className="chatkit-screencast-canvas-container">
        <canvas
          ref={canvasRef}
          className="chatkit-screencast-canvas"
        />
      </div>
    </div>
  );
}
