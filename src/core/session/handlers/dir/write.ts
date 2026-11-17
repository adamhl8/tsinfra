import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidDirOptions } from "#core/session/handlers/dir.ts"
import type { HostDirDetails } from "#core/session/handlers/dir/host-dir-details.ts"
import type { FileMode } from "#core/session/handlers/shared/filesystem/mode.ts"
import { parseFileMode, toOctalMode } from "#core/session/handlers/shared/filesystem/mode.ts"
import { buildChownLines } from "#core/session/handlers/shared/filesystem/write-script.ts"
import type { StepContext } from "#core/session/step.ts"
import { quoteShellArg } from "#utils.ts"

// Write every mode as five octal digits, because GNU `chmod` keeps a directory's setuid and setgid bits for a numeric
// mode with fewer. BSD and busybox read the leading zeros as plain octal.
const FULL_OCTAL_MODE_WIDTH = 5

/** Returns the mode to write, in five octal digits. */
const getModeArg = (mode: FileMode): string => toOctalMode(parseFileMode(mode)).padStart(FULL_OCTAL_MODE_WIDTH, "0")

/**
 * Returns the script that makes the directory and any parents it's missing, then sets its owner and mode when the
 * script gave them. Parents get the default mode and owner.
 */
const buildDirWriteScript = (hostDirDetails: HostDirDetails, options: ValidDirOptions): string => {
  const { path } = hostDirDetails
  const { mode } = options
  const attributes = hostDirDetails.kind === "new" ? undefined : hostDirDetails.attributes

  const quotedPath = quoteShellArg(path)

  // Set the owner before the mode, like `file`, because POSIX lets `chown` clear the setuid and setgid bits.
  // Linux leaves a directory's alone, but the mode must win where they're cleared.
  const chownLines = buildChownLines(attributes, quotedPath, options)
  const chmodLines = mode === undefined ? [] : [`chmod ${getModeArg(mode)} ${quotedPath}`]

  return ["set -eu", `mkdir -p ${quotedPath}`, ...chownLines, ...chmodLines].join("\n")
}

/** Makes the directory on the host with one script, with the owner and mode the script gave. */
export const writeDir = async (
  ctx: StepContext,
  hostDirDetails: HostDirDetails,
  options: ValidDirOptions,
): Promise<Result> => {
  const { shell } = ctx
  const { path } = hostDirDetails

  const writeScript = buildDirWriteScript(hostDirDetails, options)
  const writeScriptOutput = await shell.exec(writeScript, { label: "directory write script" })
  if (isErr(writeScriptOutput)) return err(`failed to write the directory at '${path}'`, writeScriptOutput)
}
