/**
 * Test stub for the `server-only` package.
 *
 * The real package throws on import outside a React Server Component, which is
 * exactly the guard we want in the application and exactly what would stop a
 * Node test from importing a server module. `vitest.config.ts` aliases the
 * package to this empty module so server modules stay testable while the guard
 * remains in force for the real build.
 */

export {};
