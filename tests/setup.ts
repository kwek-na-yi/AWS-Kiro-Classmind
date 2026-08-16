/**
 * Vitest setup file, loaded once per test file before any test runs.
 *
 * Deliberately minimal: the domain modules are pure and the AWS-facing modules
 * are mocked per test file. This is the hook for anything that must hold for
 * every test — fixed clocks, a default fast-check seed, AWS SDK mock defaults.
 */

export {};
