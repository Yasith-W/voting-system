import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// When building for GitHub Pages the app is served from
// https://<user>.github.io/voting-system/, so assets need that base path.
// Local dev and other hosts use "/".
export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/voting-system/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
  },
});
