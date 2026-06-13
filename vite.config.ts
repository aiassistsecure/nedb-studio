import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { portalPlugin } from "@interchained/portal-core/vite";

// NEDB Studio is a Portal app. The Vite config mirrors the Portal blank template
// and adds a dev proxy so the browser never talks to AiAssist directly — all AI
// calls go to the Express server on :3001, which holds AIASSIST_API_KEY.
export default defineConfig({
  plugins: [react(), portalPlugin()],
  server: {
    port: 3000,
    allowedHosts: true,
    proxy: {
      "/api": {
        target: process.env.STUDIO_API_URL ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: { "@": "/src" },
  },
});
