import { resolve } from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const entry = process.env.VITE_ENTRY ?? "map";

const entries: Record<string, string> = {
  map: resolve(__dirname, "src/views/map.html"),
  "data-table": resolve(__dirname, "src/views/data-table.html"),
};

export default defineConfig({
  root: resolve(__dirname, "src/views"),
  plugins: [viteSingleFile()],
  build: {
    rollupOptions: {
      input: entries[entry],
    },
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
  },
});
