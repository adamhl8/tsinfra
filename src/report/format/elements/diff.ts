import { styleCurrent, styleMuted, styleWanted } from "#styles.ts"

// Draw a rule with a box-drawing line, so it reads as a divider, not as text.
const RULE_CHAR = "─"

/**
 * Formats a diff's line: a removed one like what's on the host, and an added one like what the script wants. Leaves an
 * unchanged line in the terminal's own text color, which reads in any theme.
 */
export const formatDiffLine = (line: string): string => {
  if (line.startsWith("-")) return styleCurrent(line)
  if (line.startsWith("+")) return styleWanted(line)
  return line
}

/** Formats a diff's line number, padded to `width`, muted so the lines of the diff stand out. */
export const formatDiffGutter = (lineNumber: number, width: number): string =>
  styleMuted(String(lineNumber).padStart(width))

/** Formats a rule `width` wide, muted, between a diff's hunks and around the diff. */
export const formatDiffRule = (width: number): string => styleMuted(RULE_CHAR.repeat(width))
