import pc from "picocolors"

import type { EntryStatus } from "#report/entries.ts"

/** Styles a piece of text, like `styleGot` or a color from picocolors. */
export type Style = (text: string) => string

// Give each status one color, so a step's symbol and its count in the summary always match.
// Give each a word with no tense, because a line reads the same in `plan`, where nothing has changed yet.
export const STATUS_STYLES: Record<EntryStatus, { color: Style; symbol: string; word: string }> = {
  unchanged: { color: pc.green, symbol: "=", word: "unchanged" },
  observed: { color: pc.gray, symbol: "·", word: "observed" },
  changed: { color: pc.yellow, symbol: "~", word: "change" },
  ran: { color: pc.yellow, symbol: ">", word: "triggered" },
  waiting: { color: pc.blue, symbol: "?", word: "waiting" },
  failed: { color: pc.redBright, symbol: "!", word: "failed" },
}

// Color text that came from the script or the host, so it stands apart from tsinfra's own words.
// That covers the values a step compared and a read's command.
export const styleValue = (text: string): string => pc.cyan(text)

// Color an error bright red, so it stands apart from a `got` value, which is red too.
export const styleError = (text: string): string => pc.redBright(text)

// Color `got` red and `want` green, like a diff's `-` and `+` lines, because `got` is what's there and `want` replaces it.
export const styleGot = (text: string): string => pc.red(text)
export const styleWant = (text: string): string => pc.green(text)

/** Combines styles into one, applied left to right. */
const pipeStyles =
  (...styles: Style[]): Style =>
  (text) => {
    let styled = text
    for (const style of styles) styled = style(styled)
    return styled
  }

// Quote a string value, so an empty value or stray spaces still show without color.
// Color the text before quoting it, so the quotes stay uncolored and don't read as part of the value.
const styleQuoted = (text: string): string => `'${text}'`
export const styleGotString = pipeStyles(styleGot, styleQuoted)
export const styleWantString = pipeStyles(styleWant, styleQuoted)

// Italicize an exit code, because unlike a string it isn't quoted, and it should still read as a value.
export const styleGotExitCode = pipeStyles(styleGot, pc.italic)
export const styleWantExitCode = pipeStyles(styleWant, pc.italic)

/** Styles tsinfra's own aside, like "no steps" or a note in place of a diff. */
export const styleNote = pipeStyles(pc.dim, pc.italic)
