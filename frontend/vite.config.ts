import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const parsePort = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sanitizeHost = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  let sanitized = value.trim();
  if (!sanitized) {
    return undefined;
  }

  sanitized = sanitized
    // tolère les schémas mal renseignés type « https//mon-domaine »
    .replace(/^(https?|wss?):?\/\//i, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  return sanitized || undefined;
};

const withFallback = (value: string | undefined, fallback: string) =>
  sanitizeHost(value) ?? fallback;

const serverPort = parsePort(process.env.VITE_PORT, 5183);
const hmrClientPort = parsePort(process.env.VITE_HMR_CLIENT_PORT, 443);
const hmrHost = withFallback(process.env.VITE_HMR_HOST, "test.ve2fpd.com");
const hmrProtocol = process.env.VITE_HMR_PROTOCOL ?? "wss";
const backendTarget =
  process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8000";
const defaultAllowedHosts = ["chatkit.ve2fpd.com"];
const envAllowedHosts = process.env.VITE_ALLOWED_HOSTS?.split(",")
  .map((host) => sanitizeHost(host))
  .filter((host): host is string => Boolean(host));
const allowedHosts = envAllowedHosts?.length
  ? Array.from(new Set([...envAllowedHosts, ...defaultAllowedHosts]))
  : defaultAllowedHosts;

// Désactiver le proxy si VITE_USE_MOCK_API est défini (mode développement sans backend)
const useMockApi = process.env.VITE_USE_MOCK_API === "true";

export default defineConfig({
  server: {
    host: true, // écoute sur 0.0.0.0
    port: serverPort, // fixe le port
    strictPort: true, // empêche vite de changer de port
    hmr: useMockApi ? true : {
      clientPort: hmrClientPort, // important derrière Cloudflare
      host: hmrHost,
      protocol: hmrProtocol,
    },
    ...(allowedHosts?.length ? { allowedHosts } : {}),
    // Désactiver le proxy en mode mock pour que fetch soit intercepté
    ...(!useMockApi ? {
      proxy: {
        "/api": {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    } : {}),
  },
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    globals: true,
    css: true,
  },
});
