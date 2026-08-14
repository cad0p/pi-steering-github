#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * `pi-steering-github` CLI — the strip helper backing the vault
 * body-file convention.
 *
 * `gh pr create|edit` and `gh issue create|edit` bodies must come
 * from a napkin vault note, uploaded through a process substitution
 * wrapping this helper:
 *
 *   gh pr create --title "..." --body-file \
 *     <(pi-steering-github strip <vault>/<repo>/prs/2026-08-14-pr1-slug.md)
 *
 * The helper strips the note's YAML frontmatter and leading H1 and
 * prints the remaining body to stdout, so GitHub receives clean
 * markdown while the vault file stays byte-identical (the vault is
 * only ever read — see `./strip.ts` for the stripping semantics).
 */

import { pathToFileURL } from "node:url";
import { stripVaultBodyFile } from "./strip.ts";

const USAGE = `pi-steering-github — strip helper for vault body files

Usage:
  pi-steering-github strip <file>
      Strip YAML frontmatter and the leading H1 from a napkin vault
      note and print the remaining body to stdout. The file is only
      read — never modified.

      gh pr create --title "..." --body-file \\
        <(pi-steering-github strip <vault>/**/<repo>/prs/YYYY-MM-DD-pr<N>-<slug>.md)
      gh issue create --title "..." --body-file \\
        <(pi-steering-github strip <vault>/**/<repo>/issues/YYYY-MM-DD-issue<N>-<slug>.md)

Options:
  -h, --help   Show this help.
`;

/**
 * Run the CLI against explicit argv + streams (testable without a
 * real process). Returns the process exit code:
 *
 *   - `strip <file>` — stripped body on stdout, 0. Errors (missing
 *     arg, unreadable file) → stderr, 1.
 *   - `--help` / `-h` — usage on stdout, 0.
 *   - no args / unknown subcommand — usage on stderr, 1.
 */
export function runCli(
  argv: readonly string[],
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream } = {
    stdout: process.stdout,
    stderr: process.stderr,
  },
): number {
  const cmd = argv[0];
  if (cmd === undefined) {
    io.stderr.write(USAGE);
    return 1;
  }
  if (cmd === "--help" || cmd === "-h") {
    io.stdout.write(USAGE);
    return 0;
  }
  if (cmd !== "strip") {
    io.stderr.write(`pi-steering-github: unknown command "${cmd}"\n\n${USAGE}`);
    return 1;
  }
  const file = argv[1];
  if (file === undefined) {
    io.stderr.write(
      `pi-steering-github: "strip" needs a <file> argument\n\n${USAGE}`,
    );
    return 1;
  }
  try {
    io.stdout.write(stripVaultBodyFile(file));
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`pi-steering-github: cannot strip "${file}": ${message}\n`);
    return 1;
  }
}

/**
 * CLI entry point. Runs `runCli` with the process argv and exits
 * with its exit code. Only executes when this module is the main
 * module — importing it for tests must not exit the process.
 */
export function main(): void {
  process.exit(runCli(process.argv.slice(2)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
