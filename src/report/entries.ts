import { isErr } from "ts-explicit-errors"

import { HOST_FILE_EXTENSION } from "#hosts/discover.ts"
import type { HostReport } from "#hosts/run.ts"
import type { FormatOptions } from "#report/format.ts"
import { getFailedState } from "#session/converge.ts"
import type { StepKind } from "#session/session.ts"
import type { StepRecord } from "#session/step-recorder.ts"
import type { Comparison, StepDetails } from "#session/step.ts"
import type { ValueComparison } from "#session/steps/ensure.ts"
import type { FileComparison } from "#session/steps/file/comparison.ts"
import { isMultiLine } from "#utils.ts"

export type StepStatus = StepDetails["status"] | "failed"

/** An entry's name, and what kind of name it is, which decides how it's styled. */
interface EntryName {
  text: string
  kind: NameKind
}

export type NameKind =
  // A name the script gave the step.
  | "step"
  // A name that's a value: a read's or an inspect's command, a file's path, or a target.
  | "value"
  // The host's file, for a failure no step owns.
  | "scriptFile"

/** One step's part of a host block, as data. */
export interface StepEntry {
  status: StepStatus
  name: EntryName
  /** The names of the steps a waiting step needs. */
  needs?: string[]
  /** Why a failed entry failed. */
  error?: Error
  /** How a value would change, or for a failure that still differs after its fix, the host's state. */
  details?: Detail[]
}

/** What a step entry shows under its head line. */
export type Detail =
  | { kind: "diff"; got: string; want: string }
  | { kind: "valueComparison"; comparison: ValueComparison }
  // Holds everything about a file but a text diff, which is a detail of its own.
  | { kind: "fileComparison"; comparison: FileComparison }
  // The stderr of the command that read the host's state, for a failure that still differs after its fix.
  | { kind: "stderr"; stderr: string }

// Treat a read's or an inspect's name as a value, because it's the command itself, and a file's, because it's a path.
const STEP_NAME_KINDS: Record<StepKind, NameKind> = {
  read: "value",
  inspect: "value",
  file: "value",
  ensure: "step",
  run: "step",
}

// Hide a step that was already right, or only looked, unless `verbose` is on.
const SHOWN_BY_DEFAULT: Record<StepDetails["status"], boolean> = {
  unchanged: false,
  observed: false,
  changed: true,
  ran: true,
  waiting: true,
}

// Show how a string value or a file would change, because the step's name doesn't say.
// A boolean or an exit code needs no details, because the name already says what yes and no mean.
const SHOWS_CHANGE_DETAILS: Record<Comparison["kind"], boolean> = {
  string: true,
  boolean: false,
  exit: false,
  file: true,
}

/** Returns how a file differs: a diff when its content is text, then the file comparison. */
const toFileDetails = (comparison: FileComparison): Detail[] => {
  const { content } = comparison
  const diffDetails: Detail[] = content.kind === "text" ? [{ kind: "diff", got: content.got, want: content.want }] : []
  return [...diffDetails, { kind: "fileComparison", comparison }]
}

/** Returns how a value differs: a diff for a multi-line string, or the value comparison otherwise. */
const toValueDetails = (comparison: ValueComparison): Detail[] => {
  const isMultiLineString =
    comparison.kind === "string" && (isMultiLine(comparison.got) || isMultiLine(comparison.want))
  if (isMultiLineString) return [{ kind: "diff", got: comparison.got, want: comparison.want }]
  return [{ kind: "valueComparison", comparison }]
}

const toComparisonDetails = (comparison: Comparison): Detail[] =>
  comparison.kind === "file" ? toFileDetails(comparison) : toValueDetails(comparison)

/** Returns a failed entry, with the host's state as its details when it still differed after the fix. */
const toFailureEntry = (name: EntryName, error: Error): StepEntry => {
  const failedState = getFailedState(error)
  if (!failedState) return { status: "failed", name, error }

  const { comparison, commandOutput } = failedState
  // Leave out empty stderr, so a quiet command shows only how the value differs.
  const stderr = commandOutput?.stderr.trim()
  const stderrDetails: Detail[] = stderr ? [{ kind: "stderr", stderr }] : []

  return { status: "failed", name, error, details: [...toComparisonDetails(comparison), ...stderrDetails] }
}

/** Returns the entry a host block shows for a step, or nothing for a step that's hidden or never finished. */
const toStepEntry = (stepRecord: StepRecord, formatOptions: FormatOptions): StepEntry | undefined => {
  const { name: stepName, kind, details: stepDetails } = stepRecord
  const { verbose = false } = formatOptions
  const name: EntryName = { text: stepName, kind: STEP_NAME_KINDS[kind] }

  if (isErr(stepDetails)) return toFailureEntry(name, stepDetails)
  if (stepDetails === undefined) return

  const { status } = stepDetails
  const isShown = SHOWN_BY_DEFAULT[status] || verbose
  if (!isShown) return

  if (stepDetails.status === "waiting") return { status, name, needs: stepDetails.needs }

  if (stepDetails.status === "changed") {
    const { comparison } = stepDetails
    const hasDetails = SHOWS_CHANGE_DETAILS[comparison.kind]
    return { status, name, details: hasDetails ? toComparisonDetails(comparison) : [] }
  }

  return { status, name }
}

/** Returns the entries a host block shows: one per step that shows, then a failure no step owns. */
export const toStepEntries = (hostReport: HostReport, formatOptions: FormatOptions): StepEntry[] => {
  // Name a session that couldn't start after its target, because that's what failed, and the script never ran.
  if (!hostReport.started) return [toFailureEntry({ text: hostReport.target, kind: "value" }, hostReport.failure)]

  const { name, stepRecords, failure } = hostReport
  const stepEntries = stepRecords
    .map((stepRecord) => toStepEntry(stepRecord, formatOptions))
    .filter((stepEntry) => stepEntry !== undefined)

  // Show a failure that no step owns, like the script throwing, after the steps.
  // Name it after the host's file, because it comes from the script, not a step.
  const isStepFailure = stepRecords.some(({ details }) => details === failure)
  if (failure && !isStepFailure)
    stepEntries.push(toFailureEntry({ text: `${name}${HOST_FILE_EXTENSION}`, kind: "scriptFile" }, failure))

  return stepEntries
}
