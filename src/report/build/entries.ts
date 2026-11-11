import { getStepWarnings, toFailureDetails, toStepDetails } from "#report/build/details/details.ts"
import { toStepNote } from "#report/build/note.ts"
import type { EntryName, HostBlockEntry, NameKind } from "#report/host-block.ts"
import type { ReportOptions } from "#report/report.ts"
import type {
  FinishedStepRecord,
  HostRecord,
  RecordedFailure,
  StepKind,
  StepRecord,
  StepStatus,
} from "#session/session.ts"

// Hide a step that was already right, or only looked, below level 1.
const SHOWN_BY_DEFAULT: Record<StepStatus, boolean> = {
  unchanged: false,
  observed: false,
  changed: true,
  ran: true,
  waiting: true,
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

const isStepShown = (stepRecord: FinishedStepRecord, reportOptions: ReportOptions): boolean => {
  const { verbosity = 0 } = reportOptions
  // Show a step with a warning, even one that was already right, so the warning can't be missed.
  return SHOWN_BY_DEFAULT[stepRecord.status] || verbosity >= 1 || getStepWarnings(stepRecord).length > 0
}

const toStepName = ({ name, kind }: StepRecord): EntryName => ({ text: name, kind: STEP_NAME_KINDS[kind] })

const toStepEntry = (stepRecord: FinishedStepRecord): HostBlockEntry => {
  const { status, kind } = stepRecord

  const note = toStepNote(stepRecord, status)
  const name = toStepName(stepRecord)
  const details = toStepDetails(stepRecord)

  return { status, kind, name, note, details }
}

const toFailureEntry = (failure: RecordedFailure, target: string, reportOptions: ReportOptions): HostBlockEntry => {
  const details = toFailureDetails(failure, reportOptions)

  if (failure.kind === "step") {
    const { stepRecord, error } = failure
    const name = toStepName(stepRecord)
    const note = toStepNote(stepRecord, "failed")
    return { status: "failed", kind: stepRecord.kind, name, note, details, error }
  }

  // Name a failure no step owns after the host's target, because the kind already says where it failed.
  const name: EntryName = { text: target, kind: "value" }
  return { status: "failed", kind: failure.kind, name, note: [], details, error: failure.error }
}

/** Returns the entries a host block shows: one per step that shows, then the host's failure, if it failed. */
export const toHostBlockEntries = (hostRecord: HostRecord, reportOptions: ReportOptions): HostBlockEntry[] => {
  const { target, stepRecords, failure } = hostRecord
  const stepEntries = stepRecords
    .filter((stepRecord) => isStepShown(stepRecord, reportOptions))
    .map((stepRecord) => toStepEntry(stepRecord))

  // Show the failure after the steps, even a step's, because nothing runs once the host has failed.
  // That makes the step that failed the last one.
  const failureEntries = failure ? [toFailureEntry(failure, target, reportOptions)] : []
  return [...stepEntries, ...failureEntries]
}
