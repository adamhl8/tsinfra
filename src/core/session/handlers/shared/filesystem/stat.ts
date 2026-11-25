import { type } from "arktype"

import type { HostFileAttributeDetails } from "#core/session/handlers/shared/filesystem/attributes.ts"
import { statModeSchema } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { nonEmptyStringSchema } from "#core/session/step.ts"
import { splitWords } from "#core/utils.ts"

// Pair each field's GNU and BSD format, so the two forms of the command print the same columns.
// List them in the order they print, because a parser relies on it.
const STAT_FORMATS = [
  { field: "mode", gnu: "%a", bsd: "%Mp%Lp" },
  { field: "owner", gnu: "%u %g %U %G", bsd: "%u %g %Su %Sg" },
  { field: "size", gnu: "%s", bsd: "%z" },
] as const

/** A group of columns `buildStatCommand` can print. */
type StatField = (typeof STAT_FORMATS)[number]["field"]

interface StatCommandOptions {
  /** Reads the file at the end of a symlink instead of the link itself. */
  follow?: boolean
}

/**
 * Returns a command that prints `fields` of what `pathArg` names on one line, in the order mode, owner, size, whatever
 * order they're asked in. `pathArg` goes into the command as it is, so it's quoted already, like `"$p"`. `stat -c` goes
 * first, because GNU's `stat -f` prints filesystem information instead of failing. BSD needs `%Mp%Lp` to keep setuid
 * and setgid. Without `follow`, a link's own mode and owner print.
 */
export const buildStatCommand = (pathArg: string, fields: StatField[], options: StatCommandOptions = {}): string => {
  const { follow = false } = options

  const formats = STAT_FORMATS.filter(({ field }) => fields.includes(field))
  const gnuFormat = formats.map(({ gnu }) => gnu).join(" ")
  const bsdFormat = formats.map(({ bsd }) => bsd).join(" ")
  const stat = follow ? "stat -L" : "stat"

  return `${stat} -c '${gnuFormat}' ${pathArg} 2>/dev/null || ${stat} -f '${bsdFormat}' ${pathArg}`
}

const statIdSchema = type("string.integer.parse")

/**
 * The columns `owner` prints, in order: the uid, the gid, the user, and the group. A details script's schema spreads
 * them into its tuple where it asked for `owner`, after `statModeSchema` when it asked for `mode`.
 */
export const STAT_OWNER_COLUMNS = [statIdSchema, statIdSchema, nonEmptyStringSchema, nonEmptyStringSchema] as const

/** Parses the line `buildStatCommand` prints for `["mode", "owner"]`. */
export const statAttributesLineSchema = type("string")
  .pipe(splitWords)
  .to([statModeSchema, ...STAT_OWNER_COLUMNS])
  .pipe(([mode, uid, gid, user, group]): HostFileAttributeDetails => ({ mode, uid, gid, user, group }))
