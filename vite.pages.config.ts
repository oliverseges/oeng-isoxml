import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const base = repositoryName ? `/${repositoryName}/` : "/";

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname),
    },
  },
  build: {
    outDir: "pages-dist",
    emptyOutDir: true,
  },
});
