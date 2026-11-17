import { type } from "arktype"

import { nonEmptyStringSchema } from "#core/session/step.ts"

// Pair each field's GNU and BSD format, so the two forms of the command print the same columns.
// List them in the order they print, because a parser relies on it.
const STAT_FORMATS = [
  { field: "mode", gnu: "%a", bsd: "%Mp%Lp" },
  { field: "owner", gnu: "%u %g %U %G", bsd: "%u %g %Su %Sg" },
  { field: "size", gnu: "%s", bsd: "%z" },
] as const

/** A group of columns `buildStatCommand` can print. */
type StatField = (typeof STAT_FORMATS)[number]["field"]

/**
 * Returns a command that prints `fields` of what `pathArg` names on one line, in the order mode, owner, size, whatever
 * order they're asked in. `pathArg` goes into the command as it is, so it's quoted already, like `"$p"`. `stat -c` goes
 * first, because GNU's `stat -f` prints filesystem information instead of failing. BSD needs `%Mp%Lp` to keep setuid
 * and setgid. Neither follows a symlink, so a link's own mode and owner print.
 */
export const buildStatCommand = (pathArg: string, fields: StatField[]): string => {
  const formats = STAT_FORMATS.filter(({ field }) => fields.includes(field))
  const gnuFormat = formats.map(({ gnu }) => gnu).join(" ")
  const bsdFormat = formats.map(({ bsd }) => bsd).join(" ")

  return `stat -c '${gnuFormat}' ${pathArg} 2>/dev/null || stat -f '${bsdFormat}' ${pathArg}`
}

const statIdSchema = type("string.integer.parse")

/**
 * The columns `owner` prints, in order: the uid, the gid, the user, and the group. A details script's schema spreads
 * them into its tuple where it asked for `owner`, after `statModeSchema` when it asked for `mode`.
 */
export const STAT_OWNER_COLUMNS = [statIdSchema, statIdSchema, nonEmptyStringSchema, nonEmptyStringSchema] as const
