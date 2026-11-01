import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const backendTarget = env.VITE_BACKEND_TARGET || "http://127.0.0.1:8000";

  return {
    server: {
  host: "0.0.0.0",
  proxy: {
    "/api": {
      target: backendTarget,
      changeOrigin: true,
    },
    "/ws": {
      target: backendTarget,
      ws: true,
    },
  },
},
  };
});
