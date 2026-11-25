import { stringWidth } from "bun"

/** Returns the widest of `texts` in terminal columns. */
export const getMaxWidth = (texts: string[]): number => Math.max(0, ...texts.map((value) => stringWidth(value)))

/** Pads `value` with spaces to `width` terminal columns. */
export const padToWidth = (value: string, width: number): string => value + " ".repeat(width - stringWidth(value))

/** Adds a newline to the end of `text`, unless it already ends with one. */
export const endWithNewline = (text: string): string => (text.endsWith("\n") ? text : `${text}\n`)

/** Splits `text` into its lines. An empty string has none, so it can't count as one empty line. */
export const splitLines = (text: string): string[] => (text === "" ? [] : text.split("\n"))
