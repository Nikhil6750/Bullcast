// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, "/");
          if (!normalized.includes("/node_modules/")) {
            return undefined;
          }

          if (matchesPackage(normalized, [
            "react",
            "react-dom",
            "react-router-dom",
            "scheduler",
            "use-sync-external-store",
          ])) {
            return "react-vendor";
          }

          if (
            normalized.includes("/node_modules/@supabase/") ||
            matchesPackage(normalized, ["@supabase/supabase-js"])
          ) {
            return "supabase-vendor";
          }

          if (matchesPackage(normalized, ["xlsx"])) {
            return "spreadsheet-vendor";
          }

          if (
            matchesPackage(normalized, [
              "react-markdown",
              "remark-gfm",
              "prismjs",
              "unified",
            ]) ||
            normalized.includes("/node_modules/micromark") ||
            normalized.includes("/node_modules/mdast-util-") ||
            normalized.includes("/node_modules/hast-util-") ||
            normalized.includes("/node_modules/unist-util-") ||
            normalized.includes("/node_modules/vfile")
          ) {
            return "markdown-vendor";
          }

          if (matchesPackage(normalized, [
            "axios",
            "html2canvas",
            "lucide-react",
            "react-window",
          ])) {
            return "ui-vendor";
          }

          return "vendor";
        },
      },
    },
  },
});

function matchesPackage(id, packageNames) {
  return packageNames.some((packageName) => {
    const packagePath = `/node_modules/${packageName}/`;
    return id.includes(packagePath);
  });
}
