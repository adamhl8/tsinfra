import type { EntryKind, EntryStatus, NameKind } from "#report/host-block/host-block.ts"
import { STATUS_COLORS, styleItalic, styleMuted, styleValue } from "#styles.ts"
import { quoteNames } from "#utils.ts"

/**
 * Gives each status its symbol and its word. The words have no tense, because a line reads the same in `plan`, where
 * nothing has changed yet.
 */
const STATUS_TEXT: Record<EntryStatus, { symbol: string; word: string }> = {
  unchanged: { symbol: "=", word: "unchanged" },
  observed: { symbol: "·", word: "observed" },
  changed: { symbol: "~", word: "change" },
  ran: { symbol: ">", word: "triggered" },
  waiting: { symbol: "?", word: "waiting" },
  failed: { symbol: "!", word: "failed" },
}

/** Formats an entry's status as its symbol and its word in the status's color, like `~ change`. */
export const formatStatus = (status: EntryStatus): string => {
  const { symbol, word } = STATUS_TEXT[status]
  return STATUS_COLORS[status](`${symbol} ${word}`)
}

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

/** Formats the steps a waiting step needs, like `needs 'A', 'B'`. */
export const formatNeeds = (needs: string[]): string => styleMuted(`needs ${quoteNames(needs)}`)
