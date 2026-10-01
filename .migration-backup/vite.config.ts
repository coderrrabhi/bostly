import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Increase limit to suppress warnings for intentionally large chunks
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // UI library core
          "ui-core": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tabs",
            "@radix-ui/react-toast",
            "@radix-ui/react-tooltip",
          ],
          // Data fetching layer
          "data-layer": [
            "@tanstack/react-query",
            "@supabase/supabase-js",
          ],
          // Router
          "router": ["react-router-dom"],
          // Charts and heavy UI
          "charts": ["recharts"],
          // Date utilities
          "date-fns": ["date-fns"],
        },
      },
    },
  },
  // Strip debug logging from production bundles for a smaller, faster app
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : {},
}));
