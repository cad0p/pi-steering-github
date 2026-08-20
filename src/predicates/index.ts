// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

export { bodyHasClosingKeyword } from "../helpers/body-keyword.ts";
export {
  argText,
  findBodyFileValue,
  findFlagValue,
  parseBodyFileArg,
  resolveAgainstCwd,
  unquote,
} from "../helpers/pattern-args.ts";
/**
 * Bundle re-export for the predicate handler and the arg helpers.
 * The handler lives in `./missing-vault-body-file.ts`; the helpers
 * (`argText`, `unquote`, `findFlagValue`, `findBodyFileValue`,
 * `parseBodyFileArg`, `resolveAgainstCwd`, `bodyHasClosingKeyword`,
 * plus `BODY_STRIP`) live in `../helpers/` and are re-exported here
 * so consumers and the plugin index can keep a single predicates
 * path.
 */
export { BODY_STRIP, missingVaultBodyFile } from "./missing-vault-body-file.ts";
