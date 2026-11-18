import { entryNameElement, entryNoteElement, kindElement, statusElement } from "#report/format/elements/entry.ts"
import type { EntryStatus, HostBlockEntry, NotePart } from "#report/host-block.ts"
import { quoteNames } from "#utils.ts"

/** An entry's status line, with each field formatted, before layout puts them on one line. */
export interface StatusLine {
  status: string
  kind: string
  /** Unset when the entry has no name. */
  name?: string
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
  ranAlways: "always",
  ranFromOpenChanges: "triggered",
  waiting: "waiting",
  failed: "failed",
  resume: "resume",
}

const RESUME_NOTE = "an earlier apply didn't finish, so its follow-ups that didn't complete still trigger"
const TRIGGERED_BY_OPEN_CHANGE_NOTE = "triggered because it didn't complete in an earlier unfinished apply"

/** Returns the words of a part of an entry's note, like `needs 'A', 'B'`. */
const getNotePartWords = (notePart: NotePart): string => {
  if (notePart.kind === "needs") return `needs ${quoteNames(notePart.needs)}`
  if (notePart.kind === "resume") return RESUME_NOTE
  return TRIGGERED_BY_OPEN_CHANGE_NOTE
}

/** Formats the fields an entry's status line shows, and joins its note's parts into their text. */
export const formatStatusLine = (hostBlockEntry: HostBlockEntry): StatusLine => {
  const { status, kind, name, note } = hostBlockEntry
  const noteText = note.map((notePart) => getNotePartWords(notePart)).join(", ")

  return {
    // Leave the colon unstyled, so it reads as punctuation between the status and the kind.
    status: `${statusElement(status, STATUS_WORDS[status])}:`,
    kind: kindElement(kind),
    ...(name && { name: entryNameElement(name) }),
    ...(note.length > 0 && { note: entryNoteElement(noteText) }),
  }
}
