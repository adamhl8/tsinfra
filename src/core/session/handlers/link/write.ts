import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidLinkOptions } from "#core/session/handlers/link.ts"
import { findLinkChanges, isLinkItselfInSync } from "#core/session/handlers/link/comparison.ts"
import type { HostLinkDetails } from "#core/session/handlers/link/host-link-details.ts"
import { parseFileMode } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import {
  REMOVE_TEMP_DIRECTORY_LINES,
  TEMP_PATH_ARG,
  buildAttributeLines,
  buildChownLines,
  buildTempDirectoryLines,
  toWriteScriptPaths,
} from "#core/session/handlers/shared/filesystem/write-script.ts"
import type { StepContext } from "#core/session/step.ts"
import { quoteShellArg } from "#core/utils.ts"

/** Returns the lines that make the link under a temp name, then rename it into place (see `docs/transport.md`). */
const buildLinkLines = (hostLinkDetails: HostLinkDetails, target: string, options: ValidLinkOptions): string[] => {
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
  ]
}

/**
 * Returns the lines that set the mode and owner of the file at the end of the target. Sets every attribute the step
 * gives once any differs, because `compareLink` checked the write can make them.
 */
const buildTargetAttributeLines = (
  hostLinkDetails: HostLinkDetails,
  target: string,
  options: ValidLinkOptions,
): string[] => {
  const { targetAttributes } = hostLinkDetails
  const { targetAttributes: targetAttributeOptions } = options
  const { mode } = targetAttributeOptions

  const modeBits = mode === undefined ? undefined : parseFileMode(mode)
  return buildAttributeLines(targetAttributes, quoteShellArg(target), {
    ...targetAttributeOptions,
    modeBits,
    follow: true,
  })
}

/** Returns the script that writes what differs: the link, then the file at the end of its target. */
const buildLinkWriteScript = (hostLinkDetails: HostLinkDetails, target: string, options: ValidLinkOptions): string => {
  const linkChanges = findLinkChanges(hostLinkDetails, target, options)
  const isTargetInSync = linkChanges.targetAttributeChanges.length === 0
  const linkLines = isLinkItselfInSync(linkChanges) ? [] : buildLinkLines(hostLinkDetails, target, options)
  const targetLines = isTargetInSync ? [] : buildTargetAttributeLines(hostLinkDetails, target, options)

  return ["set -eu", ...linkLines, ...targetLines].join("\n")
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
