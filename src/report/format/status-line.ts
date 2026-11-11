import type { EntryKind, EntryStatus, HostBlockEntry, NameKind, NotePart } from "#report/host-block.ts"
import type { Style } from "#styles.ts"
import { STATUS_STYLES, styleAside, styleLabel, styleUnownedKind, styleValue } from "#styles.ts"
import { quoteNames } from "#utils.ts"

/** An entry's status line, with each field formatted, before layout pads them into columns. */
export interface StatusLine {
  status: string
  kind: string
  name: string
  /** Unset when the entry has no note. */
  note?: string
}

// Style a value name, because it's a command, a path, or a target.
const NAME_STYLES: Record<NameKind, Style> = {
  step: (name) => name,
  value: styleValue,
}

/** Formats a part of an entry's note, like `needs 'A', 'B'`. */
const formatNotePart = (notePart: NotePart): string => `needs ${quoteNames(notePart.needs)}`

/** Formats a host block entry's status as its symbol and its word, like `~ change`. */
const formatStatus = (status: EntryStatus): string => {
  const { symbol, word } = STATUS_STYLES[status]
  return `${symbol} ${word}`
}

/** Formats a host block entry's kind, like `(file)`, in parentheses so it reads apart from the name even without color. */
const formatKind = (kind: EntryKind): string => {
  const text = `(${kind})`
  return kind === "preparation" || kind === "host fn" ? styleUnownedKind(text) : styleLabel(text)
}

/** Formats the fields an entry's status line shows, and joins its note's parts into the note's text. */
export const formatStatusLine = (hostBlockEntry: HostBlockEntry): StatusLine => {
  const { status, kind, name, note } = hostBlockEntry
  const { color } = STATUS_STYLES[status]
  const noteText = note.map((notePart) => formatNotePart(notePart)).join(", ")

  return {
    // Leave the colon uncolored, so it reads as punctuation between the status and the kind.
    status: `${color(formatStatus(status))}:`,
    kind: formatKind(kind),
    name: NAME_STYLES[name.kind](name.text),
    ...(note.length > 0 && { note: styleAside(noteText) }),
  }
}
