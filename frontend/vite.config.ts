import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const parsePort = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const serverPort = parsePort(process.env.VITE_PORT, 5183);
const hmrClientPort = parsePort(process.env.VITE_HMR_CLIENT_PORT, 443);
const hmrHost = process.env.VITE_HMR_HOST ?? "test.ve2fpd.com";
const hmrProtocol = process.env.VITE_HMR_PROTOCOL ?? "wss";
const backendTarget =
  process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8000";
const allowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(",")
  .map((host) => host.trim())
  .filter((host) => host.length > 0);

export default defineConfig({
  server: {
    host: true, // écoute sur 0.0.0.0
    port: serverPort, // fixe le port
    strictPort: true, // empêche vite de changer de port
    hmr: {
      clientPort: hmrClientPort, // important derrière Cloudflare
      host: hmrHost,
      protocol: hmrProtocol,
    },
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    proxy: {
      "/api/chatkit/session": {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
});
