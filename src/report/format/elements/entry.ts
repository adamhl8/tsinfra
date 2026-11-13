import type { EntryKind, EntryStatus, NameKind } from "#report/host-block/host-block.ts"
import { STATUS_COLORS, styleItalic, styleMuted, styleValue } from "#styles.ts"

// Give each status a symbol, so a status reads at a glance and lines up in one column.
const STATUS_SYMBOLS: Record<EntryStatus, string> = {
  unchanged: "=",
  observed: "·",
  changed: "~",
  ran: ">",
  waiting: "?",
  failed: "!",
}

/** Formats an entry's status as its symbol and `word` in the status's color, like `~ change`. */
export const formatStatus = (status: EntryStatus, word: string): string =>
  STATUS_COLORS[status](`${STATUS_SYMBOLS[status]} ${word}`)

/**
 * Formats an entry's kind in parentheses, like `(file)`, so it reads apart from the name even without color. Italicizes
 * a failure no step owns, like `(host fn)`, so it doesn't read as a kind of step.
 */
export const formatKind = (kind: EntryKind): string => {
  const text = styleMuted(`(${kind})`)
  return kind === "preparation" || kind === "host fn" ? styleItalic(text) : text
}

/** Formats an entry's name: a step's name as it is, and a value's name, like a command or a path, in the value color. */
export const formatEntryName = (name: { kind: NameKind; text: string }): string =>
  name.kind === "value" ? styleValue(name.text) : name.text

/** Formats the note after an entry's name, like `needs 'A', 'B'`, muted so the name stays the focus. */
export const formatEntryNote = (text: string): string => styleMuted(text)
