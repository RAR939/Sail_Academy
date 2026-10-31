import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const backendTarget = env.VITE_BACKEND_TARGET || "http://127.0.0.1:8000";

  return {
    server: {
  host: "0.0.0.0",
  proxy: {
    "/api": {
      target: "http://127.0.0.1:8000",
      changeOrigin: true,
    },
    "/ws": {
      target: "ws://127.0.0.1:8000",
      ws: true,
    },
  },
},
  };
});
