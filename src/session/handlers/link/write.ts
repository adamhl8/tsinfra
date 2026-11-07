import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ValidLinkOptions } from "#session/handlers/link.ts"
import type { HostLinkDetails } from "#session/handlers/link/host-link-details.ts"
import { buildChownLines, toWriteScriptPaths } from "#session/handlers/shared/filesystem/write-script.ts"
import { quoteShellArg } from "#session/shell.ts"
import type { StepContext } from "#session/step.ts"

/** Returns the script that makes the link under a temp name, then renames it into place (see `docs/transport.md`). */
const buildLinkWriteScript = (hostLinkDetails: HostLinkDetails, target: string, options: ValidLinkOptions): string => {
  const { path } = hostLinkDetails
  const hostOwner = hostLinkDetails.kind === "new" ? undefined : hostLinkDetails.owner
  const { quotedPath, quotedDirectory, quotedTempTemplate } = toWriteScriptPaths(path)
  const quotedTarget = quoteShellArg(target)

  const chownLines = buildChownLines(hostOwner, options, '"$tmp/link"')
  // Remove an empty directory first, because a rename can't replace a directory with a link.
  const rmdirLines = hostLinkDetails.kind === "emptyDirectory" ? [`rmdir ${quotedPath}`] : []
  const moveCommand = `mv -f "$flag" "$tmp/link" ${quotedPath}`
  // Remove an old link when the rename fails, because busybox's `mv -T` won't replace a link to a directory with a link to
  // anything else, and nothing else renames a link there.
  const moveLine =
    hostLinkDetails.kind === "link"
      ? `${moveCommand} 2>/dev/null || { rm -f ${quotedPath} && ${moveCommand}; }`
      : moveCommand

  return [
    "set -eu",
    `mkdir -p ${quotedDirectory}`,
    `tmp=$(mktemp -d ${quotedTempTemplate})`,
    `trap 'rm -rf "$tmp"' EXIT`,
    `ln -s ${quotedTarget} "$tmp/link"`,
    ...chownLines,
    // Try the flag on a file of our own, because a plain `mv` follows a link to a directory, and POSIX has no flag for it.
    `touch "$tmp/probe"`,
    `if mv -T "$tmp/probe" "$tmp/probed" 2>/dev/null; then flag=-T; else flag=-h; fi`,
    ...rmdirLines,
    moveLine,
    `rm -rf "$tmp"`,
    "trap - EXIT",
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

  const output = await shell.exec(buildLinkWriteScript(hostLinkDetails, target, options), { label: "link write" })
  if (isErr(output)) return err(`failed to write the link at '${path}'`, output)
}
