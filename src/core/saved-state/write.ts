import type { SavedState } from "#core/saved-state/schema.ts"
import { buildPrivateFileWriteScript, quoteShellArg } from "#core/utils.ts"

/** Returns the script that writes `savedState` to `savedStatePath`, indented so it reads well on the host. */
export const buildSavedStateWriteScript = (savedStatePath: string, savedState: SavedState): string =>
  buildPrivateFileWriteScript(savedStatePath, `${JSON.stringify(savedState, undefined, 2)}\n`)

/** Returns the script that deletes the saved state at `savedStatePath`, which succeeds when there's no file. */
export const buildSavedStateDeleteScript = (savedStatePath: string): string =>
  `rm -f -- ${quoteShellArg(savedStatePath)}`
