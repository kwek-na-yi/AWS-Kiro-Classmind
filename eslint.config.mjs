// eslint-config-next v16 ships native flat config: each subpath export is a
// `Linter.Config[]` (CommonJS `export =`), so it spreads directly and no
// `FlatCompat` / `@eslint/eslintrc` bridge is needed.
//
// - `core-web-vitals` already includes the base config (it spreads `./index`)
//   and appends the Core Web Vitals rules.
// - `typescript` adds typescript-eslint recommended plus the global ignores for
//   `.next/**`, `out/**`, `build/**` and `next-env.d.ts`.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  // Generated output and local data, never source: Playwright's HTML report
  // ships minified bundles that would otherwise drown real findings.
  {
    ignores: [
      "playwright-report/**",
      "test-results/**",
      "blob-report/**",
      "coverage/**",
      ".classmind/**",
      ".vercel/**",
    ],
  },
];

export default eslintConfig;
