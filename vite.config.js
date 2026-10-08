import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export const navigationFallbackDenylist = [
  /^\/api(?:[/?]|$)/,
  /^\/mcp(?:[/?]|$)/,
  /^\/mcp-extension(?:[/?]|$)/,
  /^\/\.well-known\//,
  /^\/extension\.html(?:[?]|$)/,
  /^\/privacy(?:\.html)?(?:[/?]|$)/,
  /^\/release\.json(?:\?|$)/,
  /^\/welcome(?:\.html)?(?:[/?]|$)/,
  /^\/client(?:[/?]|$)/,
  /^\/coordination(?:[/?]|$)/,
];
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        app: "index.html",
        welcome: "api/welcome.html",
        purchase: "api/purchase.html",
        credits: "api/credits.html",
        coordination: "coordination/index.html",
        client: "client/index.html",
        clientPortal: "api/client-portal.html",
        clientRequests: "api/client-requests.html",
      },
    },
  },
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
            src: "/lion-mint-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/lion-mint-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
        ],
      },
      workbox: {
        importScripts: ["/notification-sw.js"],
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,webmanifest}"],
        globIgnores: [
          "client/index.html",
          "coordination/index.html",
          "api/client-portal.html",
          "api/client-requests.html",
          // Public copy and consent policies must reach their current routes.
          "api/welcome.html",
          "api/terms.html",
          "api/privacy.html",
          "privacy.html",
        ],
        // Sign-in redirects and standalone policy/release pages must reach their
        // actual routes rather than receiving the offline workspace shell.
        navigateFallbackDenylist: navigationFallbackDenylist,
      },
    }),
  ],
});
