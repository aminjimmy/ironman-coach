import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// BASE lets the app live under a sub-path, e.g. GitHub Pages: BASE=/ironman-coach/ npm run build
const base = process.env.BASE ?? "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Ironman Coach",
        short_name: "Tri Coach",
        description: "Triathlon training planner, Strava insights and fueling tracker",
        theme_color: "#0b0f14",
        background_color: "#0b0f14",
        display: "standalone",
        orientation: "any",
        start_url: base,
        scope: base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
});
