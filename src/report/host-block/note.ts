import type { HostRecord, StepRecord } from "#core/session/recorder/records.ts"
import { getFinishedStepRecords } from "#core/session/recorder/records.ts"
import type { EntryStatus, HostNote, NotePart } from "#report/host-block.ts"

/** Returns the host's note, for a host with no entries and no failure, or with a `resume` step. */
export const toHostNote = (hostRecord: HostRecord): HostNote | undefined => {
  const { entries, failure } = hostRecord
  // Show the note at every level, so it's clear the host ran.
  if (entries.length === 0 && !failure) return { kind: "noEntries", from: 0 }

  const hasResumeStep = getFinishedStepRecords(hostRecord).some(({ status }) => status === "resume")
  return hasResumeStep ? { kind: "unfinishedApply", from: 0 } : undefined
}

/** Returns a step's note, for an entry that's waiting or `ranFromOpenChanges`. */
export const toStepNote = (stepRecord: StepRecord, status: EntryStatus): NotePart[] => {
  if (status === "waiting") return [{ kind: "needs", needs: stepRecord.waitingOn, from: 0 }]
  if (status === "ranFromOpenChanges") return [{ kind: "triggeredByOpenChange", from: 0 }]

  return []
}
