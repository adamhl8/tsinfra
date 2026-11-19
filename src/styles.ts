import pc from "picocolors"

import type { EntryStatus } from "#report/host-block.ts"

/** Styles a piece of text, like `styleCurrent` or a color from picocolors. */
export type Style = (text: string) => string

/** What a secret shows as wherever it would show, as GitLab CI shows it. */
export const MASKED_VALUE = "[MASKED]"

// Show `[MASKED]` dim in every style, so a secret's stand-in reads as tsinfra's marker in any color.
const MUTED_MASKED_VALUE = pc.dim(MASKED_VALUE)

/** Styles the parts of `text` around each `[MASKED]` with `style`, and mutes each `[MASKED]`. */
const styleAroundMasked = (text: string, style: Style): string =>
  text
    .split(MASKED_VALUE)
    .map((part) => (part === "" ? "" : style(part)))
    .join(MUTED_MASKED_VALUE)

/**
 * Returns `style` as a palette style, which mutes each `[MASKED]` in the text, so no element has to. Keeps a `[MASKED]`
 * another style already muted as it is, so wrapping styled text, like italics around a color, adds no escape codes
 * around it.
 */
const createStyle =
  (style: Style): Style =>
  (text) =>
    text
      .split(MUTED_MASKED_VALUE)
      .map((styledPart) => styleAroundMasked(styledPart, style))
      .join(MUTED_MASKED_VALUE)

/** Gives each status its color. One color per status keeps a step's symbol and its count in the summary matching. */
export const STATUS_COLORS: Record<EntryStatus, Style> = {
  unchanged: createStyle(pc.green),
  observed: createStyle(pc.gray),
  changed: createStyle(pc.yellow),
  ran: createStyle(pc.yellow),
  ranAlways: createStyle(pc.yellow),
  ranFromOpenChanges: createStyle(pc.yellow),
  waiting: createStyle(pc.blue),
  failed: createStyle(pc.redBright),
  resume: createStyle(pc.cyan),
}

/** Colors what's on the host now red, like a diff's `-` lines, because the change replaces it. */
export const styleCurrent = createStyle(pc.red)

/** Colors what the script wants green, like a diff's `+` lines, because it replaces what's there. */
export const styleWanted = createStyle(pc.green)

/**
 * Colors text that came from the script or the host, like an option's value or a read's command, so it stands apart
 * from tsinfra's own words.
 */
export const styleValue = createStyle(pc.cyan)

/** Colors an error bright red, so it stands apart from what's on the host, which is red too. */
export const styleError = createStyle(pc.redBright)

/** Colors a warning bright yellow, so it stands apart from the plain yellow of a change. */
export const styleWarning = createStyle(pc.yellowBright)

/** Colors text magenta, the one color the report uses for nothing else, so it only ever means one thing. */
export const styleAccent = createStyle(pc.magenta)

/** Dims text that should recede, so the text around it stands out. */
export const styleMuted = createStyle(pc.dim)

/**
 * Leaves text in the terminal's own color, which reads in any theme, but still mutes `[MASKED]`. Recorded text that
 * shows uncolored goes through this, because only a style mutes `[MASKED]`.
 */
export const stylePlain = createStyle((text) => text)

/** Italicizes text. */
export const styleItalic = createStyle(pc.italic)

/** Bolds text. */
export const styleBold = createStyle(pc.bold)
