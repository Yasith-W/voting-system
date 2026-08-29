import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves this from /voting-system/, so assets need that base path there.
export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/voting-system/" : "/",
  plugins: [react()],
  server: {
    port: 5173,
  },
});
