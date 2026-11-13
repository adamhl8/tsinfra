import { formatEntryName, formatKind, formatNeeds, formatStatus } from "#report/format/elements/elements.ts"
import type { HostBlockEntry, NotePart } from "#report/host-block/host-block.ts"

/** An entry's status line, with each field formatted, before layout pads them into columns. */
export interface StatusLine {
  status: string
  kind: string
  name: string
  /** Unset when the entry has no note. */
  note?: string
}

/** Formats a part of an entry's note, like `needs 'A', 'B'`. */
const formatNotePart = (notePart: NotePart): string => formatNeeds(notePart.needs)

/** Formats the fields an entry's status line shows, and joins its note's parts into their text. */
export const formatStatusLine = (hostBlockEntry: HostBlockEntry): StatusLine => {
  const { status, kind, name, note } = hostBlockEntry
  const noteText = note.map((notePart) => formatNotePart(notePart)).join(", ")

  return {
    // Leave the colon unstyled, so it reads as punctuation between the status and the kind.
    status: `${formatStatus(status)}:`,
    kind: formatKind(kind),
    name: formatEntryName(name),
    ...(note.length > 0 && { note: noteText }),
  }
}
