import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidDirOptions } from "#session/handlers/dir/dir.ts"
import type { HostDirDetails } from "#session/handlers/dir/host-dir-details.ts"
import type { FileMode } from "#session/handlers/shared/shared.ts"
import { buildChownLines, parseFileMode, toOctalMode } from "#session/handlers/shared/shared.ts"
import type { StepContext } from "#session/step.ts"
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

  // Set the owner before the mode, because `chown` can clear the setuid and setgid bits.
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
