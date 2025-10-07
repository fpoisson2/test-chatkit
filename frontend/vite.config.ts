import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  server: {
    host: true,            // écoute sur 0.0.0.0
    port: 5183,            // fixe le port
    strictPort: true,      // empêche vite de changer de port
    hmr: {
      clientPort: 443,     // important derrière Cloudflare
      host: "test.ve2fpd.com",
      protocol: "wss",
    },
    proxy: {
      "/api/chatkit/session": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
});
