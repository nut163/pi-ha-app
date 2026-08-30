import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const backendPort = process.env.PORT ?? process.env.PI_HOME_AGENT_PORT ?? "8099";

export default defineConfig({
  plugins: [react()],
  root: "web",
  base: "./",
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${backendPort}`,
    },
  },
});
