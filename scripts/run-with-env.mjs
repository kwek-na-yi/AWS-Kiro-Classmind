/**
 * Runs a command with the variables from an env file loaded.
 *
 * Node's own `--env-file` cannot be used here: Next spawns a child process and
 * forwards NODE_OPTIONS, which rejects that flag. Rather than add a dependency
 * for one small job, this reads the file, merges it into the environment and
 * spawns the command itself.
 *
 * Usage:  node scripts/run-with-env.mjs <env-file> <command> [args...]
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const [envFile, command, ...args] = process.argv.slice(2);

if (!envFile || !command) {
  console.error("Usage: node scripts/run-with-env.mjs <env-file> <command> [args...]");
  process.exit(1);
}

if (!existsSync(envFile)) {
  console.error(
    `${envFile} does not exist. Create it with the variables listed in docs/configuration.md.`,
  );
  process.exit(1);
}

/**
 * Parses `KEY=VALUE` lines.
 *
 * Comments and blank lines are skipped, surrounding quotes are stripped, and a
 * value containing `=` keeps everything after the first one — session tokens
 * routinely contain them.
 */
function parse(contents) {
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key) values[key] = value;
  }

  return values;
}

const loaded = parse(readFileSync(envFile, "utf8"));

// An empty value in the file means "not set" rather than "set to empty", so a
// half-filled template does not mask a real variable from the shell.
const merged = { ...process.env };
for (const [key, value] of Object.entries(loaded)) {
  if (value !== "") merged[key] = value;
}

const child = spawn(command, args, {
  env: merged,
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
