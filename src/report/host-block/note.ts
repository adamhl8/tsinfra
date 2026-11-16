import type { EntryStatus, NotePart } from "#report/host-block/host-block.ts"
import type { StepRecord } from "#session/session.ts"

/** Returns a step's note, for an entry that's waiting, `resume`, or `ranFromOpenChanges`. */
export const toStepNote = (stepRecord: StepRecord, status: EntryStatus): NotePart[] => {
  if (status === "waiting") return [{ kind: "needs", needs: stepRecord.waitingOn, from: 0 }]
  if (status === "resume") return [{ kind: "resume", from: 0 }]
  if (status === "ranFromOpenChanges") return [{ kind: "triggeredByOpenChange", from: 0 }]

  return []
}
