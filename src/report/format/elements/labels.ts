import type { ConvergePhase } from "#core/session/recorder/records.ts"
import { styleItalic, styleMuted, styleValue } from "#styles.ts"

/** Formats a row's label with its colon, like `got:`, muted so the value after it stands out. */
export const labelElement = (name: string): string => styleMuted(`${name}:`)

/** The name of a heading over rows: a block's, like `options`, or a phase's, like `before`. */
export type HeadingName = "options" | "commands" | "output" | ConvergePhase

/**
 * Formats a heading over the rows under it, like `commands:` or a phase's `before:`, muted and italic so it reads as
 * tsinfra's, not a row's.
 */
export const headingElement = (name: HeadingName): string => styleItalic(styleMuted(`${name}:`))

/** Formats an option's name on the options line, like `env`. */
export const optionNameElement = (name: string): string => styleMuted(name)

/**
 * Formats the keys of an option that takes an object, in braces, like `{ URL, PORT }`. Uses braces, because a colon
 * would nest under `options:`, and the braces keep one option's keys apart from the next option's.
 */
export const optionEntriesElement = (keys: string[]): string =>
  `${styleMuted("{")} ${keys.map((key) => styleValue(key)).join(", ")} ${styleMuted("}")}`
