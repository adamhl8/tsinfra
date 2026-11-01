/** Returns the widest of `texts` in terminal columns. */
export const getMaxWidth = (texts: string[]) => Math.max(0, ...texts.map((value) => Bun.stringWidth(value)))

/** Pads `value` with spaces to `width` terminal columns. */
export const padToWidth = (value: string, width: number) => value + " ".repeat(width - Bun.stringWidth(value))
