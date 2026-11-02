import pc from "picocolors"

import type { StepDetails } from "#session/step.ts"

export type StepStatus = StepDetails["status"] | "failed"

// Give each status one color, so a step's symbol and its count in the summary always match.
export const STATUS_COLORS: Record<StepStatus, (text: string) => string> = {
  unchanged: pc.green,
  observed: pc.gray,
  changed: pc.yellow,
  ran: pc.yellow,
  waiting: pc.blue,
  failed: pc.red,
}

export const STEP_SYMBOLS: Record<StepStatus, string> = {
  unchanged: STATUS_COLORS.unchanged("="),
  observed: STATUS_COLORS.observed("·"),
  changed: STATUS_COLORS.changed("~"),
  ran: STATUS_COLORS.ran(">"),
  waiting: STATUS_COLORS.waiting("?"),
  failed: STATUS_COLORS.failed("!"),
}

// Color text that came from the script or the host, so it stands apart from tsinfra's own words.
// That covers a check's values and a read's command.
export const styleValue = (text: string) => pc.cyan(text)

// Color `got` red and `want` green, like a diff's `-` and `+` lines, because `got` is what's there and `want` replaces it.
export const styleGot = (text: string) => pc.red(text)
export const styleWant = (text: string) => pc.green(text)

// Italicize an exit code too, because unlike a string it isn't quoted, and it should still read as a value.
export const styleExitCode = (text: string, style: (text: string) => string) => pc.italic(style(text))

// Quote a string value, so an empty value or stray spaces still show without color.
// Leave the quotes unstyled, so they don't read as part of the value.
export const styleQuotedValue = (text: string, style: (text: string) => string) => `'${style(text)}'`

/** Styles tsinfra's own aside, like "no steps" or a note in place of a diff. */
export const styleNote = (note: string) => pc.dim(pc.italic(note))
