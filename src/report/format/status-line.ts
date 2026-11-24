import { entryNameElement, entryNoteElement, kindElement, statusElement } from "#report/format/elements/entry.ts"
import type { EntryStatus, NotePart, StatusLineEntry } from "#report/host-block.ts"
import { quoteNames } from "#utils.ts"

/** An entry's status line, with each field formatted, before layout puts them on one line. */
export interface StatusLine {
  status: string
  kind: string
  /** Unset when the entry has no name. */
  name: string | undefined
  /** Unset when the entry has no note. */
  note: string | undefined
}

// Give each status its word. The words have no tense, because a line reads the same in `plan`, where nothing has
// changed yet.
const STATUS_WORDS: Record<EntryStatus, string> = {
  unchanged: "unchanged",
  observed: "observed",
  changed: "change",
  ran: "triggered",
  ranAlways: "always",
  ranFromOpenChanges: "triggered",
  waiting: "waiting",
  failed: "failed",
  resume: "resume",
}

const TRIGGERED_BY_OPEN_CHANGE_NOTE = "triggered because it didn't complete in an earlier unfinished apply"

/** Returns the words of a part of an entry's note, like `needs 'A', 'B'`. */
const getNotePartWords = (notePart: NotePart): string => {
  if (notePart.kind === "needs") return `needs ${quoteNames(notePart.needs)}`
  return TRIGGERED_BY_OPEN_CHANGE_NOTE
}

/** Formats the fields an entry's status line shows, and joins its note's parts into their text. */
export const formatStatusLine = (statusLineEntry: StatusLineEntry): StatusLine => {
  const { status, kind } = statusLineEntry
  const name = statusLineEntry.name && entryNameElement(statusLineEntry.name)
  const noteWords = statusLineEntry.note.map((notePart) => getNotePartWords(notePart))
  const note = noteWords.length > 0 ? entryNoteElement(noteWords.join(", ")) : undefined

  return {
    // Leave the colon unstyled, so it reads as punctuation between the status and the kind.
    status: `${statusElement(status, STATUS_WORDS[status])}:`,
    kind: kindElement(kind),
    name,
    note,
  }
}
