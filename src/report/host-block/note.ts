import type { EntryStatus, NotePart } from "#report/host-block/host-block.ts"
import type { StepRecord } from "#session/session.ts"

/** Returns a step's note: a `needs` part when its entry is waiting. */
export const toStepNote = (stepRecord: StepRecord, status: EntryStatus): NotePart[] => {
  if (status === "waiting") return [{ kind: "needs", needs: stepRecord.waitingOn, from: 0 }]

  return []
}
