import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { HostFileAttributeDetails, HostOwner } from "#core/session/handlers/shared/filesystem/attributes.ts"
import {
  buildStatCommand,
  STAT_OWNER_COLUMNS,
  statAttributesLineSchema,
} from "#core/session/handlers/shared/filesystem/stat.ts"
import type { Shell } from "#core/transport/shell.ts"
import { quoteShellArg, splitWords, stripOneTrailingNewline } from "#core/utils.ts"

/** What the link details script found at a link's path, and the mode and owner of the link's target. */
export type HostLinkDetails = ExistingLinkDetails | NewLinkDetails | ReplaceableLinkDetails

interface NewLinkDetails {
  kind: "new"
  path: string
  /** The mode and owner of the file at the end of the target, or `undefined` when the target is missing. */
  targetAttributes: HostFileAttributeDetails | undefined
}

/** A symlink at the path. */
interface ExistingLinkDetails {
  kind: "link"
  path: string
  /** The mode and owner of the file at the end of the target, or `undefined` when the target is missing. */
  targetAttributes: HostFileAttributeDetails | undefined
  /** What the link points to now, which may differ from the target the script wants. */
  currentTarget: string
  owner: HostOwner
}

/** Something at the path that only `force` can replace. */
interface ReplaceableLinkDetails {
  kind: "file" | "emptyDirectory"
  path: string
  /** The mode and owner of the file at the end of the target, or `undefined` when the target is missing. */
  targetAttributes: HostFileAttributeDetails | undefined
  owner: HostOwner
}

const KIND_PREFIX = "kind="

// List what the link details script can say is at the path.
const kindLineSchema = type("string")
  .narrow((line) => line.startsWith(KIND_PREFIX))
  .pipe((line) => line.slice(KIND_PREFIX.length))
  .to("'absent' | 'link' | 'file' | 'emptyDirectory' | 'directory' | 'other'")

const statLineSchema = type("string")
  .pipe(splitWords)
  .to([...STAT_OWNER_COLUMNS])
  .pipe(([uid, gid, user, group]): HostOwner => ({ uid, gid, user, group }))

/**
 * Returns one command that says what is at `path`, its owner when the step can replace it, and then the mode and owner
 * of `target`. The path's `stat` reads a link itself, and the target's follows links to the file at the end. A new link
 * and a missing target each print an empty line, so every line keeps its place. `readlink` goes last, so a target with
 * a newline still parses.
 */
const buildLinkDetailsScript = (path: string, target: string): string =>
  [
    "set -e",
    `p=${quoteShellArg(path)}`,
    `t=${quoteShellArg(target)}`,
    `if [ -L "$p" ]; then kind=link`,
    `elif [ ! -e "$p" ]; then kind=absent`,
    `elif [ -d "$p" ]; then`,
    // List the directory on its own line, because `set -e` ignores a failed `ls` inside a test, which reads as empty.
    `  entries=$(ls -A "$p")`,
    `  if [ -z "$entries" ]; then kind=emptyDirectory; else kind=directory; fi`,
    `elif [ -f "$p" ]; then kind=file`,
    "else kind=other",
    "fi",
    `echo "kind=$kind"`,
    `case "$kind" in`,
    "  directory | other) exit 0 ;;",
    "  absent) echo ;;",
    `  *) ${buildStatCommand('"$p"', ["owner"])} ;;`,
    "esac",
    `if [ -e "$t" ]; then ${buildStatCommand('"$t"', ["mode", "owner"], { follow: true })}; else echo; fi`,
    `if [ "$kind" = link ]; then readlink "$p"; fi`,
  ].join("\n")

/**
 * Parses the link details script's output. Returns an error for something at `path` that no option lets the step
 * replace.
 */
export const parseLinkDetailsOutput = (stdout: string, path: string): Result<HostLinkDetails> => {
  const [kindLine = "", statLine = "", targetStatLine = "", ...readlinkLines] = stdout.split("\n")

  const kind = kindLineSchema(kindLine)
  if (kind instanceof type.errors)
    return err(`the link details script printed '${kindLine}' instead of what is at the path`, undefined)

  if (kind === "directory") return err(`'${path}' is a directory with files in it, so link won't replace it`, undefined)
  if (kind === "other") return err(`'${path}' isn't a link or a regular file, so link won't replace it`, undefined)

  const targetAttributes = targetStatLine === "" ? undefined : statAttributesLineSchema(targetStatLine)
  if (targetAttributes instanceof type.errors) {
    return err(
      `the link details script printed '${targetStatLine}' instead of the mode and owner of the target`,
      undefined,
    )
  }

  if (kind === "absent") return { kind: "new", path, targetAttributes }

  const owner = statLineSchema(statLine)
  if (owner instanceof type.errors)
    return err(`the link details script printed '${statLine}' instead of the owner of the path`, undefined)

  if (kind !== "link") return { kind, path, targetAttributes, owner }

  // Strip only the newline `readlink` adds, because a target can end in a newline of its own.
  const currentTarget = stripOneTrailingNewline(readlinkLines.join("\n"))
  return { kind, path, targetAttributes, currentTarget, owner }
}

/**
 * Reads what's at the link's `path` on the host. Use `exec`, because every answer the command gives exits 0, so a
 * non-zero exit means it broke.
 */
export const getHostLinkDetails = async (
  shell: Shell,
  path: string,
  target: string,
): Promise<Result<HostLinkDetails>> => {
  const stdout = await shell.exec(buildLinkDetailsScript(path, target), { label: "link details script" })
  if (isErr(stdout)) return err(`failed to read the details of '${path}'`, stdout)

  return parseLinkDetailsOutput(stdout, path)
}
