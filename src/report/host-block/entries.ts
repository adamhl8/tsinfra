import type { EntryRecord, HostRecord } from "#core/session/recorder/records.ts"
import type { Mode } from "#mode.ts"
import type { HostBlockEntry } from "#report/host-block.ts"
import { toFailureEntry } from "#report/host-block/entries/failure.ts"
import { toHostMessageEntry } from "#report/host-block/entries/host-message.ts"
import { toStepEntry } from "#report/host-block/entries/step.ts"

const toEntry = (entryRecord: EntryRecord, mode: Mode): HostBlockEntry =>
  entryRecord.kind === "hostMessage" ? toHostMessageEntry(entryRecord) : toStepEntry(entryRecord, mode)

/**
 * Returns a host block's entries, at every level: one per entry of the host's record, then the host's failure, if it
 * failed.
 */
export const toHostBlockEntries = (hostRecord: HostRecord, mode: Mode): HostBlockEntry[] => {
  const { entries, failure } = hostRecord
  const recordedEntries = entries.map((entryRecord) => toEntry(entryRecord, mode))

  // Show the failure after the other entries, even a step's, because nothing runs once the host has failed.
  // That makes the step that failed the last one.
  const failureEntries = failure ? [toFailureEntry(failure, hostRecord)] : []
  return [...recordedEntries, ...failureEntries]
}
