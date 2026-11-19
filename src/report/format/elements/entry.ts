import type { EntryKind, EntryStatus, NameKind, UnownedFailureKind } from "#report/host-block.ts"
import { STATUS_COLORS, styleItalic, styleMuted, stylePlain, styleValue } from "#styles.ts"

// Give each status a symbol, so a status reads at a glance and lines up in one column.
const STATUS_SYMBOLS: Record<EntryStatus, string> = {
  unchanged: "=",
  observed: "·",
  changed: "~",
  ran: ">",
  ranAlways: ">",
  ranFromOpenChanges: ">",
  waiting: "?",
  failed: "!",
  resume: "^",
}

/** Formats an entry's status as its symbol and `word` in the status's color, like `~ change`. */
export const statusElement = (status: EntryStatus, word: string): string =>
  STATUS_COLORS[status](`${STATUS_SYMBOLS[status]} ${word}`)

// Key the table by every kind of failure no step owns, so a new kind can't be left out of the italics.
const UNOWNED_FAILURE_KINDS: Record<UnownedFailureKind, true> = {
  preparation: true,
  "host fn": true,
  "saved state": true,
}

/**
 * Formats an entry's kind in parentheses, like `(file)`, so it reads apart from the name even without color. Italicizes
 * a failure no step owns, like `(host fn)`, so it doesn't read as a kind of step.
 */
export const kindElement = (kind: EntryKind): string => {
  const text = styleMuted(`(${kind})`)
  return Object.hasOwn(UNOWNED_FAILURE_KINDS, kind) ? styleItalic(text) : text
}

/** Formats an entry's name: a step's name as it is, and a value's name, like a command or a path, in the value color. */
export const entryNameElement = (name: { kind: NameKind; text: string }): string =>
  name.kind === "value" ? styleValue(name.text) : stylePlain(name.text)

/** Formats the note after an entry's name, like `needs 'A', 'B'`, muted so the name stays the focus. */
export const entryNoteElement = (text: string): string => styleMuted(text)
