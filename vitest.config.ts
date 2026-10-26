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
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      // Mirrors the `@/*` path alias in tsconfig.json so a test imports a module
      // by the same specifier the application code uses.
      "@": rootDir,
      // `server-only` throws on import outside a React Server Component, which
      // would make every server module untestable. The stub keeps the guard in
      // the real build while letting tests import those modules directly.
      "server-only": path.resolve(rootDir, "tests/stubs/server-only.ts"),
    },
  },
});
