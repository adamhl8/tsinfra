import pc from "picocolors"

import type { EntryStatus } from "#report/report.ts"

/** Styles a piece of text, like `styleCurrent` or a color from picocolors. */
export type Style = (text: string) => string

/** Gives each status its color. One color per status keeps a step's symbol and its count in the summary matching. */
export const STATUS_COLORS: Record<EntryStatus, Style> = {
  unchanged: pc.green,
  observed: pc.gray,
  changed: pc.yellow,
  ran: pc.yellow,
  waiting: pc.blue,
  failed: pc.redBright,
}

/** Colors what's on the host now red, like a diff's `-` lines, because the change replaces it. */
export const styleCurrent = (text: string): string => pc.red(text)

/** Colors what the script wants green, like a diff's `+` lines, because it replaces what's there. */
export const styleWanted = (text: string): string => pc.green(text)

/**
 * Colors text that came from the script or the host, like an option's value or a read's command, so it stands apart
 * from tsinfra's own words.
 */
export const styleValue = (text: string): string => pc.cyan(text)

/** Colors an error bright red, so it stands apart from what's on the host, which is red too. */
export const styleError = (text: string): string => pc.redBright(text)

/** Colors a warning bright yellow, so it stands apart from the plain yellow of a change. */
export const styleWarning = (text: string): string => pc.yellowBright(text)

/** Colors text magenta, the one color the report uses for nothing else, so it only ever means one thing. */
export const styleAccent = (text: string): string => pc.magenta(text)

/** Dims text that should recede, so the text around it stands out. */
export const styleMuted = (text: string): string => pc.dim(text)

/** Italicizes text. */
export const styleItalic = (text: string): string => pc.italic(text)

/** Bolds text. */
export const styleBold = (text: string): string => pc.bold(text)
