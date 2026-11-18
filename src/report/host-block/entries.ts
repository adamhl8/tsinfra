import type {
  FinishedStepRecord,
  HostRecord,
  CommandRecord,
  RecordedFailure,
  RecordedUnownedFailure,
  StepRecord,
} from "#core/session/recorder/records.ts"
import type { StepKind, StepStatus } from "#core/session/step.ts"
import type { Detail, EntryName, HostBlockEntry, NameKind } from "#report/host-block.ts"
import {
  toHintDetails,
  toHostFunctionFailureDetails,
  toPreparationFailureDetails,
  toSavedStateFailureDetails,
  toStepDetails,
  toStepFailureDetails,
} from "#report/host-block/details.ts"
import { toStepNote } from "#report/host-block/note.ts"
import type { Verbosity } from "#report/verbosity.ts"

// Show a step that was already right, or only looked, from level 1, because it changed nothing on the host.
// Show a `resume` step from level 0, because it's rare, and it explains the follow-ups it triggers.
const ENTRY_LEVELS: Record<StepStatus, Verbosity> = {
  unchanged: 1,
  observed: 1,
  changed: 0,
  ran: 0,
  ranFromOpenChanges: 0,
  waiting: 0,
  resume: 0,
}

// Treat a read's or an inspect's name as a value, because it's the command itself, and a file's, a link's, or a
// directory's, because it's a path.
const STEP_NAME_KINDS: Record<StepKind, NameKind> = {
  read: "value",
  inspect: "value",
  file: "value",
  link: "value",
  dir: "value",
  ensure: "step",
  run: "step",
}

/** Returns a step's name with the kind of name it is, which decides how it's styled. */
export const toStepName = ({ name, kind }: StepRecord): EntryName => ({ text: name, kind: STEP_NAME_KINDS[kind] })

const toStepEntry = (stepRecord: FinishedStepRecord): HostBlockEntry => {
  const { status, kind } = stepRecord

  const name = toStepName(stepRecord)
  const note = toStepNote(stepRecord, status)
  const details = toStepDetails(stepRecord)

  return { status, kind, name, note, details, from: ENTRY_LEVELS[status] }
}

/** Returns what a failure no step owns shows under its error, before any hints, for its kind. */
const toUnownedFailureDetails = (failure: RecordedUnownedFailure, preparationCommands: CommandRecord[]): Detail[] => {
  if (failure.kind === "preparation") return toPreparationFailureDetails(preparationCommands)
  if (failure.kind === "host fn") return toHostFunctionFailureDetails()
  return toSavedStateFailureDetails()
}

const toFailureEntry = (failure: RecordedFailure, hostRecord: HostRecord): HostBlockEntry => {
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
  const unownedFailureEntry: HostBlockEntry = {
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

/** Returns a host block's entries: one per finished step, at every level, then the host's failure, if it failed. */
export const toHostBlockEntries = (hostRecord: HostRecord): HostBlockEntry[] => {
  const { stepRecords, failure } = hostRecord
  const stepEntries = stepRecords.map((stepRecord) => toStepEntry(stepRecord))

  // Show the failure after the steps, even a step's, because nothing runs once the host has failed.
  // That makes the step that failed the last one.
  const failureEntries = failure ? [toFailureEntry(failure, hostRecord)] : []
  return [...stepEntries, ...failureEntries]
}
