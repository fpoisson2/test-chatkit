/**
 * SSHTerminal component for interactive SSH terminal sessions.
 *
 * Uses xterm.js to render a terminal that connects to the backend
 * via WebSocket for SSH communication.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

export interface SSHTerminalProps {
  /** Token for authenticating the SSH session */
  sshToken: string;
  /** Optional auth token for additional authentication */
  authToken?: string;
  /** Callback when the connection is closed */
  onClose?: () => void;
  /** Callback when a connection error occurs */
  onConnectionError?: (error: string) => void;
}

export function SSHTerminal({
  sshToken,
  authToken,
  onClose,
  onConnectionError,
}: SSHTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current) return;

    // Create terminal instance
    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Fira Code", "Cascadia Code", Menlo, Monaco, monospace',
      fontSize: 14,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#ffffff",
        cursorAccent: "#000000",
        selectionBackground: "#264f78",
        black: "#000000",
        red: "#cd3131",
        green: "#0dbc79",
        yellow: "#e5e510",
        blue: "#2472c8",
        magenta: "#bc3fbc",
        cyan: "#11a8cd",
        white: "#e5e5e5",
        brightBlack: "#666666",
        brightRed: "#f14c4c",
        brightGreen: "#23d18b",
        brightYellow: "#f5f543",
        brightBlue: "#3b8eea",
        brightMagenta: "#d670d6",
        brightCyan: "#29b8db",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
    });

    // Create and load fit addon
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Open terminal in container
    terminal.open(terminalRef.current);

    // Store refs
    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Delay fit to ensure container has proper dimensions
    const fitTimeout = setTimeout(() => {
      fitAddon.fit();
    }, 100);

    // Handle window resize
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };
    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => {
      clearTimeout(fitTimeout);
      window.removeEventListener("resize", handleResize);
      terminal.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Connect WebSocket
  useEffect(() => {
    if (!sshToken || !terminalInstanceRef.current) return;

    const terminal = terminalInstanceRef.current;

    // Build WebSocket URL
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/computer/ssh/ws?token=${sshToken}`;

    terminal.writeln("\x1b[33mConnexion au serveur SSH...\x1b[0m");

    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      setConnectionError(null);
      terminal.writeln("\x1b[32mConnecte!\x1b[0m\r\n");

      // Fit and focus terminal
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
      terminal.focus();
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data);
        terminal.write(data);
      } else if (typeof event.data === "string") {
        terminal.write(event.data);
      }
    };

    ws.onerror = (event) => {
      console.error("WebSocket error:", event);
      const errorMsg = "Erreur de connexion WebSocket";
      setConnectionError(errorMsg);
      terminal.writeln(`\r\n\x1b[31m${errorMsg}\x1b[0m`);
      onConnectionError?.(errorMsg);
    };

    ws.onclose = (event) => {
      setIsConnected(false);
      if (event.wasClean) {
        terminal.writeln("\r\n\x1b[33mConnexion fermee.\x1b[0m");
      } else {
        const errorMsg = `Connexion perdue (code: ${event.code})`;
        setConnectionError(errorMsg);
        terminal.writeln(`\r\n\x1b[31m${errorMsg}\x1b[0m`);
        onConnectionError?.(errorMsg);
      }
      onClose?.();
    };

    // Handle terminal input
    const onData = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Handle terminal resize
    const onResize = terminal.onResize(({ cols, rows }) => {
      // Send resize message to server (optional - server may not support)
      if (ws.readyState === WebSocket.OPEN) {
        // Could send a resize control message here if the server supports it
        console.debug(`Terminal resized to ${cols}x${rows}`);
      }
    });

    // Cleanup
    return () => {
      onData.dispose();
      onResize.dispose();
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [sshToken, authToken, onClose, onConnectionError]);

  // Re-fit terminal when container size changes
  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    });

    if (terminalRef.current) {
      observer.observe(terminalRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div className="chatkit-ssh-terminal-container">
      <div className="chatkit-ssh-terminal-header">
        <span className="chatkit-ssh-terminal-title">
          Terminal SSH
        </span>
        <span
          className={`chatkit-ssh-terminal-status ${isConnected ? "connected" : "disconnected"}`}
        >
          {isConnected ? "Connecte" : connectionError || "Deconnecte"}
        </span>
      </div>
      <div
        ref={terminalRef}
        className="chatkit-ssh-terminal"
        style={{
          width: "100%",
          minWidth: "600px",
          height: "400px",
          backgroundColor: "#1e1e1e",
          borderRadius: "0 0 8px 8px",
          overflow: "hidden",
        }}
      />
    </div>
  );
}

export default SSHTerminal;
