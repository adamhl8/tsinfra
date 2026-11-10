import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostLinkDetails } from "#session/handlers/link/host-link-details.ts"
import type { ValidLinkOptions } from "#session/handlers/link/link.ts"
import {
  REMOVE_TEMP_DIRECTORY_LINES,
  TEMP_PATH_ARG,
  buildChownLines,
  buildTempDirectoryLines,
  toWriteScriptPaths,
} from "#session/handlers/shared/shared.ts"
import type { StepContext } from "#session/step.ts"
import { quoteShellArg } from "#utils.ts"

/** Returns the script that makes the link under a temp name, then renames it into place (see `docs/transport.md`). */
const buildLinkWriteScript = (hostLinkDetails: HostLinkDetails, target: string, options: ValidLinkOptions): string => {
  const { path } = hostLinkDetails
  const currentOwner = hostLinkDetails.kind === "new" ? undefined : hostLinkDetails.owner

  const writeScriptPaths = toWriteScriptPaths(path)
  const { quotedPath, quotedDirectory } = writeScriptPaths
  const quotedTarget = quoteShellArg(target)

  const chownLines = buildChownLines(currentOwner, TEMP_PATH_ARG, options)
  // Remove an empty directory first, because a rename can't replace a directory with a link.
  const rmdirLines = hostLinkDetails.kind === "emptyDirectory" ? [`rmdir ${quotedPath}`] : []

  const moveCommand = `mv -f "$flag" ${TEMP_PATH_ARG} ${quotedPath}`
  // Remove an old link when the rename fails, because busybox's `mv -T` won't replace a link to a directory with a link to
  // anything else, and nothing else renames a link there.
  const moveLine =
    hostLinkDetails.kind === "link"
      ? `${moveCommand} 2>/dev/null || { rm -f ${quotedPath} && ${moveCommand}; }`
      : moveCommand

  return [
    "set -eu",
    `mkdir -p ${quotedDirectory}`,
    ...buildTempDirectoryLines(writeScriptPaths),
    // Try the flag on a file of our own, because a plain `mv` follows a link to a directory, and POSIX has no flag for it.
    // Try it before the link exists, so its names can't be the link's own.
    `touch "$tmp/probe"`,
    `if mv -T "$tmp/probe" "$tmp/probed" 2>/dev/null; then flag=-T; else flag=-h; fi`,
    `rm -f "$tmp/probe" "$tmp/probed"`,
    `ln -s ${quotedTarget} ${TEMP_PATH_ARG}`,
    ...chownLines,
    ...rmdirLines,
    moveLine,
    ...REMOVE_TEMP_DIRECTORY_LINES,
  ].join("\n")
}

/**
 * Makes the link on the host with one script, so the path is what was there or the complete new link, with two
 * exceptions (see `docs/transport.md`).
 */
export const writeLink = async (
  ctx: StepContext,
  hostLinkDetails: HostLinkDetails,
  target: string,
  options: ValidLinkOptions,
): Promise<Result> => {
  const { shell } = ctx
  const { path } = hostLinkDetails

  const writeScript = buildLinkWriteScript(hostLinkDetails, target, options)
  const writeScriptOutput = await shell.exec(writeScript, { label: "link write script" })
  if (isErr(writeScriptOutput)) return err(`failed to write the link at '${path}'`, writeScriptOutput)
}
