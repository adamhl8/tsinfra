import type {
  CommandRecord,
  HostRecord,
  RecordedFailure,
  RecordedUnownedFailure,
} from "#core/session/recorder/records.ts"
import type { Detail, EntryName, StatusLineEntry } from "#report/host-block.ts"
import {
  toHintDetails,
  toHostFunctionFailureDetails,
  toPreparationFailureDetails,
  toSavedStateFailureDetails,
  toStepFailureDetails,
} from "#report/host-block/details.ts"
import { toStepName } from "#report/host-block/entries/step.ts"
import { toStepNote } from "#report/host-block/note.ts"

/** Returns what a failure no step owns shows under its error, before any hints, for its kind. */
const toUnownedFailureDetails = (failure: RecordedUnownedFailure, preparationCommands: CommandRecord[]): Detail[] => {
  if (failure.kind === "preparation") return toPreparationFailureDetails(preparationCommands)
  if (failure.kind === "host fn") return toHostFunctionFailureDetails()
  return toSavedStateFailureDetails()
}

/** Returns the entry of the host's failure: a step's, or one no step owns. */
export const toFailureEntry = (failure: RecordedFailure, hostRecord: HostRecord): StatusLineEntry => {
  const { target, preparationCommands } = hostRecord
  // Show the hints last under every kind of failure, because they say how to fix it.
  const hintDetails = toHintDetails(failure.hints)

  if (failure.kind === "step") {
    const { stepRecord, error } = failure
    const name = toStepName(stepRecord)
    const note = toStepNote(stepRecord, "failed")
    const stepFailureDetails = toStepFailureDetails(stepRecord)
    const details = [...stepFailureDetails, ...hintDetails]
    return { status: "failed", kind: stepRecord.kind, name, note, details, from: 0, error }
  }

  const details = [...toUnownedFailureDetails(failure, preparationCommands), ...hintDetails]
  const unownedFailureEntry: StatusLineEntry = {
    status: "failed",
    kind: failure.kind,
    note: [],
    details,
    from: 0,
    error: failure.error,
  }

  // Leave a host function failure unnamed, because the host function runs on the control machine, not the target.
  // The block's header already names the host.
  if (failure.kind === "host fn") return unownedFailureEntry

  // Name a failure from work tsinfra did on the host after the host's target, because the kind already says what failed.
  const name: EntryName = { text: target, kind: "value" }
  return { ...unownedFailureEntry, name }
}
