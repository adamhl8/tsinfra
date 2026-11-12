import { toFailureDetails, toStepDetails } from "#report/host-block/details/details.ts"
import type { EntryName, HostBlockEntry, NameKind } from "#report/host-block/host-block.ts"
import { toStepNote } from "#report/host-block/note.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type {
  FinishedStepRecord,
  HostRecord,
  RecordedFailure,
  StepKind,
  StepRecord,
  StepStatus,
} from "#session/session.ts"

// Show a step that was already right, or only looked, from level 1, because it changed nothing on the host.
const ENTRY_LEVELS: Record<StepStatus, Verbosity> = {
  unchanged: 1,
  observed: 1,
  changed: 0,
  ran: 0,
  waiting: 0,
}

// Treat a read's or an inspect's name as a value, because it's the command itself, and a file's or a link's, because it's a path.
const STEP_NAME_KINDS: Record<StepKind, NameKind> = {
  read: "value",
  inspect: "value",
  file: "value",
  link: "value",
  ensure: "step",
  run: "step",
}

const toStepName = ({ name, kind }: StepRecord): EntryName => ({ text: name, kind: STEP_NAME_KINDS[kind] })

const toStepEntry = (stepRecord: FinishedStepRecord): HostBlockEntry => {
  const { status, kind } = stepRecord

  const name = toStepName(stepRecord)
  const note = toStepNote(stepRecord, status)
  const details = toStepDetails(stepRecord)

  return { status, kind, name, note, details, from: ENTRY_LEVELS[status] }
}

const toFailureEntry = (failure: RecordedFailure, target: string): HostBlockEntry => {
  const details = toFailureDetails(failure)

  if (failure.kind === "step") {
    const { stepRecord, error } = failure
    const name = toStepName(stepRecord)
    const note = toStepNote(stepRecord, "failed")
    return { status: "failed", kind: stepRecord.kind, name, note, details, from: 0, error }
  }

  // Name a failure no step owns after the host's target, because the kind already says where it failed.
  const name: EntryName = { text: target, kind: "value" }
  return { status: "failed", kind: failure.kind, name, note: [], details, from: 0, error: failure.error }
}

/** Returns a host block's entries: one per finished step, at every level, then the host's failure, if it failed. */
export const toHostBlockEntries = (hostRecord: HostRecord): HostBlockEntry[] => {
  const { target, stepRecords, failure } = hostRecord
  const stepEntries = stepRecords.map((stepRecord) => toStepEntry(stepRecord))

  // Show the failure after the steps, even a step's, because nothing runs once the host has failed.
  // That makes the step that failed the last one.
  const failureEntries = failure ? [toFailureEntry(failure, target)] : []
  return [...stepEntries, ...failureEntries]
}
