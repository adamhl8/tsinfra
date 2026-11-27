import type { HostRecord } from "#core/recorder/records.ts"
import type { FinishedStepRecord } from "#core/recorder/records/step.ts"
import { getFinishedStepRecords } from "#core/recorder/records/step.ts"
import type { HostNote, NotePart } from "#report/host-block.ts"

/** Returns the host's note, for a host with no entries and no failure, or with a `resume` step. */
export const toHostNote = (hostRecord: HostRecord): HostNote | undefined => {
  const { entries, failure } = hostRecord
  // Show the note at every level, so it's clear the host ran.
  if (entries.length === 0 && !failure) return { kind: "noEntries", from: 0 }

  const hasResumeStep = getFinishedStepRecords(hostRecord).some(({ status }) => status === "resume")
  return hasResumeStep ? { kind: "unfinishedApply", from: 0 } : undefined
}

/** Returns a finished step's note, for one that's waiting or `ranFromOpenChanges`. */
export const toStepNote = (stepRecord: FinishedStepRecord): NotePart[] => {
  const { waitingOn, status } = stepRecord
  if (status === "waiting") return [{ kind: "needs", needs: waitingOn, from: 0 }]
  if (status === "ranFromOpenChanges") return [{ kind: "triggeredByOpenChange", from: 0 }]

  return []
}
