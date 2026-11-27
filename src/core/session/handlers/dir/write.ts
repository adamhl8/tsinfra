import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HandlerContext } from "#core/session/context.ts"
import type { ValidDirOptions } from "#core/session/handlers/dir.ts"
import type { HostDirDetails } from "#core/session/handlers/dir/host-dir-details.ts"
import { parseFileMode } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { buildAttributeLines } from "#core/session/handlers/shared/filesystem/write-script.ts"
import { quoteShellArg } from "#core/utils.ts"

/**
 * Returns the script that makes the directory and any parents it's missing, then sets its owner and mode when the
 * script gave them. Parents get the default mode and owner.
 */
const buildDirWriteScript = (hostDirDetails: HostDirDetails, options: ValidDirOptions): string => {
  const { path } = hostDirDetails
  const { mode } = options
  const attributes = hostDirDetails.kind === "new" ? undefined : hostDirDetails.attributes

  const quotedPath = quoteShellArg(path)
  const modeBits = mode === undefined ? undefined : parseFileMode(mode)
  const attributeLines = buildAttributeLines(attributes, quotedPath, { ...options, modeBits })

  return ["set -eu", `mkdir -p ${quotedPath}`, ...attributeLines].join("\n")
}

/** Makes the directory on the host with one script, with the owner and mode the script gave. */
export const writeDir = async (
  ctx: HandlerContext,
  hostDirDetails: HostDirDetails,
  options: ValidDirOptions,
): Promise<Result> => {
  const { shell } = ctx.step
  const { path } = hostDirDetails

  const writeScript = buildDirWriteScript(hostDirDetails, options)
  const writeScriptOutput = await shell.exec(writeScript, { label: "directory write script" })
  if (isErr(writeScriptOutput)) return err(`failed to write the directory at '${path}'`, writeScriptOutput)
}
