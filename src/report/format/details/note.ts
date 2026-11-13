import { formatNote } from "#report/format/elements/elements.ts"
import type { DetailNote, StillDiffersPhase } from "#report/host-block/host-block.ts"

// Say when the commands ran, because the phases' names are internal.
const PHASE_DESCRIPTIONS: Record<StillDiffersPhase, string> = {
  fix: "during the fix",
  after: "after the fix",
}

/** Returns the words of an aside under an entry, for its kind. */
const getNoteWords = (note: DetailNote): string => {
  if (note.kind === "valuesBeforeFix") return "values before the fix"
  if (note.kind === "hostFunctionFailure") return "thrown in the host function, outside any step"
  return `some commands ${PHASE_DESCRIPTIONS[note.phase]} wrote to stderr, run with -vvv to see what they printed`
}

/** Formats an aside under an entry, in the words for its kind. */
export const formatDetailNote = (note: DetailNote): string => formatNote(getNoteWords(note))
