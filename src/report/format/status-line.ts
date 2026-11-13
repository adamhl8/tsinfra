import { formatEntryName, formatEntryNote, formatKind, formatStatus } from "#report/format/elements/elements.ts"
import type { EntryStatus, HostBlockEntry, NotePart } from "#report/host-block/host-block.ts"
import { quoteNames } from "#utils.ts"

/** An entry's status line, with each field formatted, before layout pads them into columns. */
export interface StatusLine {
  status: string
  kind: string
  name: string
  /** Unset when the entry has no note. */
  note?: string
}

// Give each status its word. The words have no tense, because a line reads the same in `plan`, where nothing has
// changed yet.
const STATUS_WORDS: Record<EntryStatus, string> = {
  unchanged: "unchanged",
  observed: "observed",
  changed: "change",
  ran: "triggered",
  waiting: "waiting",
  failed: "failed",
}

/** Returns the words of a part of an entry's note, like `needs 'A', 'B'`. */
const getNotePartWords = (notePart: NotePart): string => `needs ${quoteNames(notePart.needs)}`

/** Formats the fields an entry's status line shows, and joins its note's parts into their text. */
export const formatStatusLine = (hostBlockEntry: HostBlockEntry): StatusLine => {
  const { status, kind, name, note } = hostBlockEntry
  const noteText = note.map((notePart) => getNotePartWords(notePart)).join(", ")

  return {
    // Leave the colon unstyled, so it reads as punctuation between the status and the kind.
    status: `${formatStatus(status, STATUS_WORDS[status])}:`,
    kind: formatKind(kind),
    name: formatEntryName(name),
    ...(note.length > 0 && { note: formatEntryNote(noteText) }),
  }
}
