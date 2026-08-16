import path from "node:path";
import { defineConfig } from "vitest/config";

// `process.cwd()` rather than `import.meta.url`: Vite may load this `.ts` config
// as CommonJS, where ESM-only syntax warns today and breaks under the native
// config loader. npm runs a script from the package root, so this is the root.
const rootDir = path.resolve(process.cwd());

export default defineConfig({
  test: {
    // Everything under test in this project is a pure function or a module
    // running against mocked AWS, so no DOM environment is needed.
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json so a test imports a module
    // by the same specifier the application code uses.
    alias: {
      "@": rootDir,
    },
  },
});
