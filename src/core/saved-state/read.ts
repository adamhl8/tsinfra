import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { SavedState } from "#core/saved-state/schema.ts"
import { savedStateFileSchema } from "#core/saved-state/schema.ts"
import type { Shell } from "#core/transport/shell.ts"
import { quoteShellArg } from "#core/utils.ts"

// Print a marker for a missing file, because it isn't valid JSON, so it can't be mistaken for a file's contents.
const NO_FILE_MARKER = "absent"

/** Returns one command that prints the file at `savedStatePath`, or the marker when nothing is there. */
const buildSavedStateReadScript = (savedStatePath: string): string => {
  const quotedPath = quoteShellArg(savedStatePath)
  return `if [ -e ${quotedPath} ]; then cat -- ${quotedPath}; else printf '%s' ${NO_FILE_MARKER}; fi`
}

/**
 * Reads the saved state at `savedStatePath` on the host, or `undefined` when there's no file. Fails when the file can't
 * be read, or isn't saved state tsinfra wrote.
 */
export const readSavedState = async (shell: Shell, savedStatePath: string): Promise<Result<SavedState | undefined>> => {
  const savedStateReadScript = buildSavedStateReadScript(savedStatePath)
  const stdout = await shell.exec(savedStateReadScript)
  if (isErr(stdout)) return err(`failed to read the saved state in '${savedStatePath}'`, stdout)
  if (stdout === NO_FILE_MARKER) return undefined

  const savedState = savedStateFileSchema(stdout)
  if (savedState instanceof type.errors) {
    return err(
      `the saved state in '${savedStatePath}' isn't saved state tsinfra wrote`,
      err(savedState.summary, undefined),
    )
  }

  return savedState
}
