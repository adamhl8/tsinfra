import type { HostRecord } from "#core/session/recorder/records.ts"
import type { CommandRecord } from "#core/session/recorder/records/command.ts"
import type { RecordedFailure, RecordedUnownedFailure } from "#core/session/recorder/records/failure.ts"
import type { Detail, EntryName, FailureEntry } from "#report/host-block.ts"
import {
  toHintDetails,
  toHostFunctionFailureDetails,
  toPreparationFailureDetails,
  toSavedStateFailureDetails,
  toStepFailureDetails,
} from "#report/host-block/details.ts"
import { toStepName } from "#report/host-block/entries/step.ts"

/** Returns what a failure no step owns shows under its error, before any hints, for its kind. */
const toUnownedFailureDetails = (failure: RecordedUnownedFailure, preparationCommands: CommandRecord[]): Detail[] => {
  if (failure.kind === "preparation") return toPreparationFailureDetails(preparationCommands)
  if (failure.kind === "host fn") return toHostFunctionFailureDetails()
  return toSavedStateFailureDetails()
}

/** Returns the entry of the host's failure: a step's, or one no step owns. */
export const toFailureEntry = (failure: RecordedFailure, hostRecord: HostRecord): FailureEntry => {
  const { target, preparationCommands } = hostRecord
  // Show the hints last under every kind of failure, because they say how to fix it.
  const hintDetails = toHintDetails(failure.hints)

  if (failure.kind === "step") {
    const { stepRecord, error } = failure
    const name = toStepName(stepRecord)
    const stepFailureDetails = toStepFailureDetails(stepRecord)
    const details = [...stepFailureDetails, ...hintDetails]
    return { status: "failed", kind: stepRecord.kind, name, note: [], details, from: 0, error }
  }

  const { kind, error } = failure
  // Leave a host function failure unnamed, because the host function runs on the control machine, not the target.
  // The block's header already names the host.
  // Name a failure from work tsinfra did on the host after the host's target, because the kind already says what failed.
  const name: EntryName | undefined = kind === "host fn" ? undefined : { text: target, kind: "value" }
  const details = [...toUnownedFailureDetails(failure, preparationCommands), ...hintDetails]
  return { status: "failed", kind, name, note: [], details, from: 0, error }
}
