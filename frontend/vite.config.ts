import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Spotify only accepts loopback redirect URIs written as 127.0.0.1 (not "localhost"),
// so the dev server binds there. /api calls go to the FastAPI backend.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
