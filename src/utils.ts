const TRAILING_NEWLINES = /\n+$/v

/** Returns the widest of `texts` in terminal columns. */
export const getMaxWidth = (texts: string[]): number => Math.max(0, ...texts.map((value) => Bun.stringWidth(value)))

/** Pads `value` with spaces to `width` terminal columns. */
export const padToWidth = (value: string, width: number): string => value + " ".repeat(width - Bun.stringWidth(value))

/** Reports whether `text` spans more than one line. */
export const isMultiLine = (text: string): boolean => text.includes("\n")

/** Removes every newline at the end of `text`. */
export const stripTrailingNewlines = (text: string): string => text.replace(TRAILING_NEWLINES, "")

/** Adds a newline to the end of `text`, unless it already ends with one. */
export const endWithNewline = (text: string): string => (text.endsWith("\n") ? text : `${text}\n`)

/** Wraps each name in single quotes and joins them into a list, like `'a', 'b'`. */
export const quoteNames = (names: Iterable<string>): string => Array.from(names, (name) => `'${name}'`).join(", ")
