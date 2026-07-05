import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // served as a GitHub Pages project page under this subpath
  base: "/free-kick-game/",
  plugins: [react(), tailwindcss()],
});
