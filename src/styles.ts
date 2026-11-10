import pc from "picocolors"

import type { HostBlockEntryStatus } from "#report/report.ts"

/** Styles a piece of text, like `styleGot` or a color from picocolors. */
export type Style = (text: string) => string

/**
 * Gives each status its color, symbol, and word. One color per status keeps a step's symbol and its count in the
 * summary matching. The words have no tense, because a line reads the same in `plan`, where nothing has changed yet.
 */
export const STATUS_STYLES: Record<HostBlockEntryStatus, { color: Style; symbol: string; word: string }> = {
  unchanged: { color: pc.green, symbol: "=", word: "unchanged" },
  observed: { color: pc.gray, symbol: "·", word: "observed" },
  changed: { color: pc.yellow, symbol: "~", word: "change" },
  ran: { color: pc.yellow, symbol: ">", word: "triggered" },
  waiting: { color: pc.blue, symbol: "?", word: "waiting" },
  failed: { color: pc.redBright, symbol: "!", word: "failed" },
}

/** Colors a warning bright yellow, so it stands apart from the plain yellow of a change. */
export const styleWarning = (text: string): string => pc.yellowBright(text)

/**
 * Colors text that came from the script or the host, like a compared value or a read's command, so it stands apart from
 * tsinfra's own words.
 */
export const styleValue = (text: string): string => pc.cyan(text)

/** Colors an error bright red, so it stands apart from a `got` value, which is red too. */
export const styleError = (text: string): string => pc.redBright(text)

/** Colors a `got` value red, like a diff's `-` lines, because it's what's there. */
export const styleGot = (text: string): string => pc.red(text)

/** Colors a `want` value green, like a diff's `+` lines, because it replaces `got`. */
export const styleWant = (text: string): string => pc.green(text)

/** Combines styles into one, applied left to right. */
const pipeStyles =
  (...styles: Style[]): Style =>
  (text) => {
    let styled = text
    for (const style of styles) styled = style(styled)
    return styled
  }

/** Quotes a string value, so an empty value or stray spaces still show without color. */
const styleQuoted = (text: string): string => `'${text}'`

/** Colors a `got` string, then quotes it, so the quotes stay uncolored and don't read as part of the value. */
export const styleGotString = pipeStyles(styleGot, styleQuoted)

/** Colors a `want` string, then quotes it, so the quotes stay uncolored and don't read as part of the value. */
export const styleWantString = pipeStyles(styleWant, styleQuoted)

/**
 * Colors a `got` exit code and italicizes it, because it isn't quoted like a string, and it should still read as a
 * value.
 */
export const styleGotExitCode = pipeStyles(styleGot, pc.italic)

/**
 * Colors a `want` exit code and italicizes it, because it isn't quoted like a string, and it should still read as a
 * value.
 */
export const styleWantExitCode = pipeStyles(styleWant, pc.italic)

/** Colors a hint like a warning, and italicizes it, because it has no label to set it apart. */
export const styleHint = pipeStyles(pc.yellowBright, pc.italic)

/** Styles tsinfra's own aside, like "no steps" or a note in place of a diff. */
export const styleNote = pipeStyles(pc.dim, pc.italic)

/** Dims a row's label or a step's kind, because each names what follows, and the value is what should stand out. */
export const styleLabel = (text: string): string => pc.dim(text)

/**
 * Styles the `(host)` and `(host fn)` kinds like a label in italics, so a failure no step owns doesn't read as a kind
 * of step.
 */
export const styleHostKind = pipeStyles(styleLabel, pc.italic)

/** Dims a waiting step's note or the plan reminder, so the steps and the hosts stay the main thing on their lines. */
export const styleAside = (text: string): string => pc.dim(text)

/** Dims a diff's line numbers and rules, so the lines of the diff stand out. */
export const styleDiffFrame = (text: string): string => pc.dim(text)

/** Italicizes words that describe a change, like `new file`, because they don't show a value. */
export const styleDescription = (text: string): string => pc.italic(text)

/** Italicizes the host script's name, because it isn't a step. */
export const styleHostScript = (text: string): string => pc.italic(text)

/** Bolds a block's host name, so each block starts clearly. */
export const styleHostName = (text: string): string => pc.bold(text)
