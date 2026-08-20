// SPDX-License-Identifier: MIT
// Part of pi-steering-github.

/**
 * Bundle re-export for the predicate handler and the arg helpers.
 * Interim form — points at the monolithic predicate module until
 * the helpers extraction lands.
 */
export {
  argText,
  BODY_STRIP,
  bodyHasClosingKeyword,
  findBodyFileValue,
  findFlagValue,
  missingVaultBodyFile,
  parseBodyFileArg,
  resolveAgainstCwd,
  unquote,
} from "./missing-vault-body-file.ts";
