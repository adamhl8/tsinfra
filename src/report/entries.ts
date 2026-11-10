import { isErr } from "ts-explicit-errors"

import type { FormatOptions } from "#report/format/format.ts"
import type { StepWarning } from "#report/warnings.ts"
import { getStepWarnings } from "#report/warnings.ts"
import type {
  EnsureComparisonValues,
  FileComparisonValues,
  LinkComparisonValues,
  CommandRecord,
  ConvergePhase,
  HostRecord,
  RecordedStepFailure,
  RecordedUnownedFailure,
  StepRecord,
  ComparisonValues,
  StepKind,
  StepStatus,
} from "#session/session.ts"
import { isMultiLine } from "#utils.ts"

export type HostBlockEntryStatus = StepStatus | "failed"

/** What a host block entry is about: a kind of step, or a failure no step owns. */
export type HostBlockEntryKind = StepKind | UnownedFailureKind

/** Where a failure no step owns happened: in preparation, or in the host function, for `host fn`. */
type UnownedFailureKind = RecordedUnownedFailure["kind"]

/** A host block entry's name, and what kind of name it is, which decides how it's styled. */
interface HostBlockEntryName {
  text: string
  kind: NameKind
}

export type NameKind =
  // A name the script gave the step.
  | "step"
  // A name that's a value: a read's or an inspect's command, a file's or a link's path, or a target.
  | "value"

/** One step's part of a host block, as data. */
export interface HostBlockEntry {
  status: HostBlockEntryStatus
  /** What the host block entry is about, which the head line shows before the name. */
  kind: HostBlockEntryKind
  name: HostBlockEntryName
  /** The names of the steps a waiting step needs. */
  needs?: string[]
  /** Why a failed host block entry failed. */
  error?: Error
  /** How a value would change, or for a failure, what the step last found on the host. */
  details: Detail[]
}

/** What a host block entry shows under its head line. */
export type Detail =
  | { kind: "diff"; got: string; want: string }
  // Holds everything about a file but a text diff, which is a detail of its own.
  | { kind: "fileComparisonValues"; values: FileComparisonValues }
  | { kind: "linkComparisonValues"; values: LinkComparisonValues }
  | { kind: "ensureComparisonValues"; values: EnsureComparisonValues }
  // The stderr of a command that can explain a failure that still differs after its fix.
  | { kind: "stderr"; command: string; stderr: string }
  // tsinfra's own aside about the details around it.
  | { kind: "note"; text: string }
  // Something that worked, but needs a look, like a link to a path where nothing exists.
  | { kind: "warning"; warning: StepWarning }
  // How to fix a failure, like setting the host's `sudo` option.
  | { kind: "hint"; text: string }

// Treat a read's or an inspect's name as a value, because it's the command itself, and a file's or a link's, because it's a path.
const STEP_NAME_KINDS: Record<StepKind, NameKind> = {
  read: "value",
  inspect: "value",
  file: "value",
  link: "value",
  ensure: "step",
  run: "step",
}

// Hide a step that was already right, or only looked, unless `verbose` is on.
const SHOWN_BY_DEFAULT: Record<StepStatus, boolean> = {
  unchanged: false,
  observed: false,
  changed: true,
  ran: true,
  waiting: true,
}

const BEFORE_FIX_NOTE = "values before the fix"
const HOST_FUNCTION_FAILURE_NOTE = "thrown in the host function, outside any step"

// Look at what the fix did and what the last compare saw, because the failure is about the state after the fix.
// Leave out `before`, because it ran earlier, so it can't explain that state.
const STILL_DIFFERS_PHASES = ["fix", "after"] as const satisfies ConvergePhase[]
type StillDiffersPhase = (typeof STILL_DIFFERS_PHASES)[number]

// Say when the commands ran, because the phases' names are internal.
const PHASE_DESCRIPTIONS: Record<StillDiffersPhase, string> = {
  fix: "during the fix",
  after: "after the fix",
}

// Show how a string value, a file, or a link would change, because the step's name doesn't say.
// A boolean or an exit code needs no details, because the name already says what yes and no mean.
const SHOWS_CHANGE_DETAILS: Record<ComparisonValues["kind"], boolean> = {
  string: true,
  boolean: false,
  exit: false,
  file: true,
  link: true,
}

/** Returns how a file differs: a diff when its content is text, then its comparison values. */
const toFileComparisonDetails = (values: FileComparisonValues): Detail[] => {
  const { content } = values
  const diffDetails: Detail[] = content.kind === "text" ? [{ kind: "diff", got: content.got, want: content.want }] : []
  return [...diffDetails, { kind: "fileComparisonValues", values }]
}

/** Returns how a check's answer differs: a diff for a multi-line string, or its comparison values otherwise. */
const toEnsureComparisonDetails = (values: EnsureComparisonValues): Detail[] => {
  const isMultiLineString = values.kind === "string" && (isMultiLine(values.got) || isMultiLine(values.want))
  if (isMultiLineString) return [{ kind: "diff", got: values.got, want: values.want }]
  return [{ kind: "ensureComparisonValues", values }]
}

const toComparisonValuesDetails = (values: ComparisonValues): Detail[] => {
  if (values.kind === "file") return toFileComparisonDetails(values)
  if (values.kind === "link") return [{ kind: "linkComparisonValues", values }]
  return toEnsureComparisonDetails(values)
}

const getCommandStderr = (commandRecord: CommandRecord): string | undefined => {
  const { output } = commandRecord
  if (output === undefined || isErr(output)) return undefined

  return output.stderr.trim() || undefined
}

/**
 * Returns the stderr that can explain a step that still differs, from one phase. A phase with one command shows that
 * command's stderr, because it's clear what it relates to. A phase with several can't say which one matters, so it only
 * gets a note. A command tsinfra wrote itself never counts, because its code already handled what it printed.
 */
const toPhaseStderrDetails = (commandRecords: CommandRecord[], phase: StillDiffersPhase): Detail[] => {
  const phaseCommandRecords = commandRecords.filter(
    (commandRecord) => commandRecord.phase === phase && commandRecord.label === undefined,
  )

  if (phaseCommandRecords.length > 1) {
    const hasStderr = phaseCommandRecords.some((commandRecord) => getCommandStderr(commandRecord) !== undefined)
    const text = `some commands ${PHASE_DESCRIPTIONS[phase]} wrote to stderr, run with -vvv to see them`
    return hasStderr ? [{ kind: "note", text }] : []
  }

  const [onlyCommandRecord] = phaseCommandRecords
  const stderr = onlyCommandRecord && getCommandStderr(onlyCommandRecord)
  return onlyCommandRecord && stderr ? [{ kind: "stderr", command: onlyCommandRecord.cmd, stderr }] : []
}

/** Returns what a failed step shows under its error. */
const toFailureDetails = (stepRecord: StepRecord, formatOptions: FormatOptions): Detail[] => {
  const { commands, comparisons } = stepRecord
  const { before, after } = comparisons
  const { verbose = false } = formatOptions

  // Show nothing for a compare that came back in sync, because a failure the script caught is what failed the step.
  if (after) {
    if (after.inSync) return []

    const stderrDetails = STILL_DIFFERS_PHASES.flatMap((phase) => toPhaseStderrDetails(commands, phase))
    return [...toComparisonValuesDetails(after.values), ...stderrDetails]
  }

  // Hide the state from before the fix unless asked, because the error says what went wrong.
  // Label it, because it may no longer be true.
  if (verbose && before && !before.inSync)
    return [{ kind: "note", text: BEFORE_FIX_NOTE }, ...toComparisonValuesDetails(before.values)]

  return []
}

const toHintDetails = (hints: string[]): Detail[] => hints.map((text) => ({ kind: "hint", text }))

/** Returns the name a step's entry shows, and what kind of name it is. */
const toStepEntryName = ({ name, kind }: StepRecord): HostBlockEntryName => ({
  text: name,
  kind: STEP_NAME_KINDS[kind],
})

/**
 * Returns the entry a host block shows for a step, or nothing for a step that's hidden or has no status, like the step
 * that failed.
 */
const toStepEntry = (stepRecord: StepRecord, formatOptions: FormatOptions): HostBlockEntry | undefined => {
  const { kind, status, comparisons, waitingOn } = stepRecord
  if (status === undefined) return

  const { verbose = false } = formatOptions
  const name = toStepEntryName(stepRecord)

  // Show a step with a warning, even one that was already right, so the warning can't be missed.
  const warningDetails: Detail[] = getStepWarnings(stepRecord).map((warning) => ({ kind: "warning", warning }))
  const isShown = SHOWN_BY_DEFAULT[status] || verbose || warningDetails.length > 0
  if (!isShown) return

  if (status === "waiting") return { status, kind, name, needs: waitingOn, details: [] }

  if (status === "changed") {
    const values = comparisons.before?.values
    const hasDetails = values && SHOWS_CHANGE_DETAILS[values.kind]
    const changeDetails = hasDetails ? toComparisonValuesDetails(values) : []
    return { status, kind, name, details: [...changeDetails, ...warningDetails] }
  }

  return { status, kind, name, details: warningDetails }
}

/** Returns the entry for the step that failed, with the host's failure, which the step owns. */
const toFailedStepEntry = (stepFailure: RecordedStepFailure, formatOptions: FormatOptions): HostBlockEntry => {
  const { stepRecord, error, hints } = stepFailure
  const details = [...toFailureDetails(stepRecord, formatOptions), ...toHintDetails(hints)]
  return { status: "failed", kind: stepRecord.kind, name: toStepEntryName(stepRecord), error, details }
}

/**
 * Returns the entry for a failure no step owns, named after the host's target, because the kind already says where it
 * failed.
 */
const toUnownedFailureEntry = (unownedFailure: RecordedUnownedFailure, target: string): HostBlockEntry => {
  const { kind, error, hints } = unownedFailure
  // Add a note to a host function failure, because `host fn` alone doesn't say it came from the script and not the host.
  const noteDetails: Detail[] = kind === "host fn" ? [{ kind: "note", text: HOST_FUNCTION_FAILURE_NOTE }] : []
  const details = [...noteDetails, ...toHintDetails(hints)]
  return { status: "failed", kind, name: { text: target, kind: "value" }, error, details }
}

/** Returns the entries a host block shows: one per step that shows, then the host's failure, if it failed. */
export const toHostBlockEntries = (hostRecord: HostRecord, formatOptions: FormatOptions): HostBlockEntry[] => {
  const { target, stepRecords, failure } = hostRecord
  const hostBlockEntries = stepRecords
    .map((stepRecord) => toStepEntry(stepRecord, formatOptions))
    .filter((hostBlockEntry) => hostBlockEntry !== undefined)

  // Show the failure after the steps, even a step's, because nothing runs once the host has failed.
  // That makes the step that failed the last one.
  if (failure) {
    const failureEntry =
      failure.kind === "step" ? toFailedStepEntry(failure, formatOptions) : toUnownedFailureEntry(failure, target)
    hostBlockEntries.push(failureEntry)
  }

  return hostBlockEntries
}
