import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Resolves the "@/*" alias from tsconfig.json (built into Vite; the
  // vite-tsconfig-paths plugin the Next.js guide suggests is now redundant).
  resolve: { tsconfigPaths: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    exclude: ["node_modules/**", ".next/**", ".agents/**"],
  },
});
