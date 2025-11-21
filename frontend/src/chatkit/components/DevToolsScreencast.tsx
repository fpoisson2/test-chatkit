import React, { useEffect, useRef, useState } from 'react';

interface DevToolsScreencastProps {
  debugUrl: string;
  className?: string;
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

export function DevToolsScreencast({ debugUrl, className = '' }: DevToolsScreencastProps): JSX.Element {
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

    const connect = () => {
      try {
        // Extract WebSocket URL from debug URL
        // Format is typically: devtools://devtools/bundled/inspector.html?ws=localhost:9222/devtools/page/...
        // We need to extract the ws parameter and convert to ws://
        const wsMatch = debugUrl.match(/[?&]ws=([^&]+)/);
        if (!wsMatch) {
          setError('Invalid debug URL format');
          return;
        }

        const wsPath = wsMatch[1];
        const wsUrl = `ws://${wsPath}`;

        console.log('[DevToolsScreencast] Connecting to:', wsUrl);
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
  }, [debugUrl]);

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
