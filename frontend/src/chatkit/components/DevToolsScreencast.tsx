import React, { useEffect, useRef, useState } from 'react';

interface DevToolsScreencastProps {
  debugUrlToken: string;
  authToken?: string; // JWT token for authentication
  className?: string;
  onConnectionError?: () => void; // Callback when connection fails
  onLastFrame?: (frameDataUrl: string) => void; // Callback with last frame before closing
  enableInput?: boolean; // Capture keyboard/mouse events and forward to CDP
}

// Global map to track tokens that have fatal errors (like 403)
// This persists across component remounts (important for React Strict Mode)
const fatalErrorTokens = new Set<string>();

interface ScreencastFrame {
  sessionId: number;
  data: string; // base64 encoded JPEG
  metadata: {
    timestamp: number;
    deviceWidth: number;
    deviceHeight: number;
  };
}

export function DevToolsScreencast({
  debugUrlToken,
  authToken,
  className = '',
  enableInput = false,
  onConnectionError,
  onLastFrame,
}: DevToolsScreencastProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  // Initialize error state based on whether the token has a fatal error
  const [error, setError] = useState<string | null>(() =>
    fatalErrorTokens.has(debugUrlToken) ? 'Token invalide ou expiré' : null
  );
  const [frameCount, setFrameCount] = useState(0);
  const [currentUrl, setCurrentUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messageIdRef = useRef(1);
  const lastMetadataRef = useRef<ScreencastFrame['metadata'] | null>(null);
  const shouldAutoFocusRef = useRef(false);
  const onLastFrameRef = useRef(onLastFrame);
  const hasHandledFatalErrorRef = useRef(false);

  // Keep the ref updated with the latest callback
  useEffect(() => {
    onLastFrameRef.current = onLastFrame;
  }, [onLastFrame]);

  useEffect(() => {
    let mounted = true;
    let ws: WebSocket | null = null;

    // Reset the handled flag when token changes
    hasHandledFatalErrorRef.current = false;

    // Check if this token has already had a fatal error
    if (fatalErrorTokens.has(debugUrlToken)) {
      console.log('[DevToolsScreencast] Token has fatal error, not attempting connection:', debugUrlToken.substring(0, 8));

      // Only call setError and onConnectionError once to avoid infinite loop
      if (!hasHandledFatalErrorRef.current) {
        hasHandledFatalErrorRef.current = true;
        setError('Token invalide ou expiré');
        if (onConnectionError) {
          onConnectionError();
        }
      }
      return;
    }

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

          // Enable Page domain events
          const enablePageCommand = {
            id: messageIdRef.current++,
            method: 'Page.enable',
          };
          ws?.send(JSON.stringify(enablePageCommand));

          // Get current navigation history
          const getNavigationHistoryCommand = {
            id: messageIdRef.current++,
            method: 'Page.getNavigationHistory',
          };
          ws?.send(JSON.stringify(getNavigationHistoryCommand));

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

          if (enableInput) {
            shouldAutoFocusRef.current = true;
          }
        };

        ws.onmessage = (event) => {
          if (!mounted) return;

          try {
            const message = JSON.parse(event.data);

            // Handle screencast frame
            if (message.method === 'Page.screencastFrame') {
              const frameData: ScreencastFrame = message.params;

              // Keep track of latest frame metadata to map pointer events
              if (frameData.metadata) {
                lastMetadataRef.current = frameData.metadata;
              }

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

            // Handle frame navigation to update URL
            if (message.method === 'Page.frameNavigated') {
              const frame = message.params?.frame;
              if (frame && frame.url) {
                setCurrentUrl(frame.url);
                setUrlInput(frame.url);

                // Request updated navigation history after navigation
                const getNavigationHistoryCommand = {
                  id: messageIdRef.current++,
                  method: 'Page.getNavigationHistory',
                };
                ws?.send(JSON.stringify(getNavigationHistoryCommand));
              }
            }

            // Handle Page.getNavigationHistory response
            if (message.result && message.result.entries) {
              const currentIndex = message.result.currentIndex;
              const entries = message.result.entries;

              if (typeof currentIndex === 'number' && Array.isArray(entries)) {
                setCanGoBack(currentIndex > 0);
                setCanGoForward(currentIndex < entries.length - 1);

                // Update current URL from history if available
                if (entries[currentIndex] && entries[currentIndex].url) {
                  const url = entries[currentIndex].url;
                  setCurrentUrl(url);
                  setUrlInput(url);
                }
              }
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

          // Don't attempt reconnection if this token has a fatal error (like 403)
          if (fatalErrorTokens.has(debugUrlToken)) {
            console.log('[DevToolsScreencast] Not reconnecting due to fatal error');
            return;
          }

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
        const errorMessage = err instanceof Error ? err.message : String(err);
        setError(`Failed to connect: ${errorMessage}`);

        // Don't retry if it's a 403 (Forbidden) - token is likely invalid/expired
        if (errorMessage.includes('403')) {
          console.log('[DevToolsScreencast] Got 403 Forbidden - token invalid/expired, marking token as fatal and not retrying');
          fatalErrorTokens.add(debugUrlToken); // Mark this token as having a fatal error
          if (onConnectionError) {
            onConnectionError();
          }
          return;
        }

        // Retry on other errors
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

      // Capture last frame before closing
      if (onLastFrameRef.current && canvasRef.current) {
        try {
          const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.9);
          onLastFrameRef.current(dataUrl);
          console.log('[DevToolsScreencast] Captured last frame before closing');
        } catch (err) {
          console.error('[DevToolsScreencast] Error capturing last frame:', err);
        }
      }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debugUrlToken, authToken]);

  const sendCdpCommand = (command: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(command));
    }
  };

  const navigateToUrl = (url: string) => {
    if (!url.trim()) return;

    // Add protocol if missing
    let normalizedUrl = url.trim();
    if (!normalizedUrl.match(/^https?:\/\//i)) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    const command = {
      id: messageIdRef.current++,
      method: 'Page.navigate',
      params: { url: normalizedUrl },
    };
    sendCdpCommand(command);
    setUrlInput(normalizedUrl);
    setCurrentUrl(normalizedUrl);
  };

  const goBack = () => {
    const command = {
      id: messageIdRef.current++,
      method: 'Page.goBack',
    };
    sendCdpCommand(command);

    // Request updated navigation history
    setTimeout(() => {
      const getHistoryCommand = {
        id: messageIdRef.current++,
        method: 'Page.getNavigationHistory',
      };
      sendCdpCommand(getHistoryCommand);
    }, 100);
  };

  const goForward = () => {
    const command = {
      id: messageIdRef.current++,
      method: 'Page.goForward',
    };
    sendCdpCommand(command);

    // Request updated navigation history
    setTimeout(() => {
      const getHistoryCommand = {
        id: messageIdRef.current++,
        method: 'Page.getNavigationHistory',
      };
      sendCdpCommand(getHistoryCommand);
    }, 100);
  };

  const refresh = () => {
    const command = {
      id: messageIdRef.current++,
      method: 'Page.reload',
      params: { ignoreCache: false },
    };
    sendCdpCommand(command);
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateToUrl(urlInput);
  };

  const mapPointerToPage = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const metadata = lastMetadataRef.current;
    if (!canvas || !metadata) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = metadata.deviceWidth / canvas.width;
    const scaleY = metadata.deviceHeight / canvas.height;

    const canvasX = ((clientX - rect.left) / rect.width) * canvas.width;
    const canvasY = ((clientY - rect.top) / rect.height) * canvas.height;

    return {
      x: canvasX * scaleX,
      y: canvasY * scaleY,
    };
  };

  useEffect(() => {
    if (enableInput && isConnected && shouldAutoFocusRef.current && canvasRef.current) {
      canvasRef.current.focus({ preventScroll: true });
      shouldAutoFocusRef.current = false;
    }
  }, [enableInput, isConnected, frameCount]);

  const focusCanvas = () => {
    if (enableInput && canvasRef.current) {
      canvasRef.current.focus({ preventScroll: true });
    }
  };

  const getModifierMask = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) =>
    (event.altKey ? 1 : 0) +
    (event.ctrlKey ? 2 : 0) +
    (event.metaKey ? 4 : 0) +
    (event.shiftKey ? 8 : 0);

  const handleMouseEvent = (
    type: 'mousePressed' | 'mouseReleased' | 'mouseMoved',
    event: React.MouseEvent<HTMLCanvasElement>
  ) => {
    if (!enableInput) return;
    focusCanvas();
    const position = mapPointerToPage(event.clientX, event.clientY);
    if (!position) return;

    event.preventDefault();

    const buttonMap: Record<number, 'left' | 'middle' | 'right'> = {
      0: 'left',
      1: 'middle',
      2: 'right',
    };

    const command = {
      id: messageIdRef.current++,
      method: 'Input.dispatchMouseEvent',
      params: {
        type,
        x: position.x,
        y: position.y,
        button: buttonMap[event.button] || 'left',
        clickCount: 1,
        modifiers: getModifierMask(event),
      },
    };

    sendCdpCommand(command);
  };

  const handleWheel = (event: React.WheelEvent<HTMLCanvasElement>) => {
    if (!enableInput) return;
    focusCanvas();
    const position = mapPointerToPage(event.clientX, event.clientY);
    if (!position) return;

    event.preventDefault();

    const command = {
      id: messageIdRef.current++,
      method: 'Input.dispatchMouseEvent',
      params: {
        type: 'mouseWheel',
        x: position.x,
        y: position.y,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        button: 'none',
        clickCount: 0,
      },
    };

    sendCdpCommand(command);
  };

  const handleKeyEvent = (type: 'keyDown' | 'keyUp', event: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!enableInput) return;
    focusCanvas();
    event.preventDefault();

    const virtualKeyCode = (event.nativeEvent as KeyboardEvent).keyCode || event.keyCode;
    const text = event.key.length === 1 ? event.key : undefined;

    const params: Record<string, unknown> = {
      type,
      key: event.key,
      code: event.code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
      modifiers: getModifierMask(event),
      location: event.location,
      autoRepeat: event.repeat,
    };

    if (type === 'keyDown' && text) {
      params.text = text;
      params.unmodifiedText = text;
    }

    const command = {
      id: messageIdRef.current++,
      method: 'Input.dispatchKeyEvent',
      params,
    };

    sendCdpCommand(command);
  };

  return (
    <div className={`chatkit-devtools-screencast ${className}`}>
      {error && (
        <div className="chatkit-screencast-error">
          ⚠️ {error}
        </div>
      )}

      <div className="chatkit-browser-toolbar">
        <div className="chatkit-browser-controls">
          <button
            type="button"
            onClick={goBack}
            disabled={!isConnected || !canGoBack}
            className="chatkit-browser-button"
            title="Page précédente"
            aria-label="Page précédente"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 12L6 8l4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={goForward}
            disabled={!isConnected || !canGoForward}
            className="chatkit-browser-button"
            title="Page suivante"
            aria-label="Page suivante"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 12l4-4-4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={!isConnected}
            className="chatkit-browser-button"
            title="Actualiser"
            aria-label="Actualiser"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M13 4L13 7L10 7M3 12L3 9L6 9M13 7C12.5 5.5 11.5 4 9.5 3.5C6.5 2.5 3.5 4 2.5 7M3 9C3.5 10.5 4.5 12 6.5 12.5C9.5 13.5 12.5 12 13.5 9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleUrlSubmit} className="chatkit-address-bar">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            disabled={!isConnected}
            className="chatkit-address-input"
            placeholder="Entrez une URL..."
            aria-label="Barre d'adresse"
          />
        </form>

        <div className="chatkit-browser-status">
          {isConnected ? (
            <span className="chatkit-status-badge chatkit-status-live" title={`${frameCount} frames reçues`}>
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
          onMouseDown={(e) => handleMouseEvent('mousePressed', e)}
          onMouseUp={(e) => handleMouseEvent('mouseReleased', e)}
          onMouseMove={(e) => handleMouseEvent('mouseMoved', e)}
          onWheel={handleWheel}
          onKeyDown={(e) => handleKeyEvent('keyDown', e)}
          onKeyUp={(e) => handleKeyEvent('keyUp', e)}
        />
      </div>
    </div>
  );
}
