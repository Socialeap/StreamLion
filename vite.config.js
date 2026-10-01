import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export const navigationFallbackDenylist = [
  /^\/api(?:[/?]|$)/,
  /^\/mcp(?:[/?]|$)/,
  /^\/privacy\.html(?:\?|$)/,
  /^\/release\.json(?:\?|$)/,
];
export default defineConfig({
  define: {
    __STREAMLION_REVISION__: JSON.stringify(
      process.env.CF_PAGES_COMMIT_SHA || "development",
    ),
  },
  plugins: [
    react(),
    {
      name: "streamlion-release-stamp",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "release.json",
          source: JSON.stringify({
            service: "streamlion",
            revision: process.env.CF_PAGES_COMMIT_SHA || "development",
          }),
        });
      },
    },
    VitePWA({
      registerType: "prompt",
      manifest: {
        name: "StreamLion",
        short_name: "StreamLion",
        description: "Local field workspace for spatial capture",
        theme_color: "#194f39",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/lion-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/lion-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        // Sign-in redirects and standalone policy/release pages must reach their
        // actual routes rather than receiving the offline workspace shell.
        navigateFallbackDenylist: navigationFallbackDenylist,
      },
    }),
  ],
});
