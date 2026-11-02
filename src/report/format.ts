import pc from "picocolors"
import { isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import { HOST_FILE_EXTENSION } from "#hosts/discover.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasPendingChange } from "#hosts/run.ts"
import { getMaxWidth, padToWidth } from "#report/utils.ts"
import type { HostState } from "#session/converge.ts"
import { getFailedState } from "#session/converge.ts"
import type { StepRecord } from "#session/step-records.ts"
import type { Comparison, StepDetails } from "#session/step.ts"

const INDENT = "  "
const ERROR_INDENT = INDENT.repeat(3)
const COLUMN_GAP = "   "
const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

type StepStatus = StepDetails["status"] | "failed"

// Give each status one color, so a step's symbol and its count in the summary always match.
const STATUS_COLORS: Record<StepStatus, (text: string) => string> = {
  unchanged: pc.green,
  observed: pc.gray,
  changed: pc.yellow,
  ran: pc.yellow,
  waiting: pc.blue,
  failed: pc.red,
}

const STEP_SYMBOLS: Record<StepStatus, string> = {
  unchanged: STATUS_COLORS.unchanged("="),
  observed: STATUS_COLORS.observed("·"),
  changed: STATUS_COLORS.changed("~"),
  ran: STATUS_COLORS.ran(">"),
  waiting: STATUS_COLORS.waiting("?"),
  failed: STATUS_COLORS.failed("!"),
}

interface StepLine {
  symbol: string
  name: string
  /** Text after the name, like the steps a waiting step needs. */
  note?: string
  errorLines?: string[]
}

// Color text that came from the script or the host, so it stands apart from tsinfra's own words.
// That covers a check's values and a read's command.
const styleValue = (text: string) => pc.cyan(text)

// Italicize an exit code too, because unlike a string it isn't quoted, and it should still read as a value.
const styleExitCode = (text: string) => pc.italic(styleValue(text))

/**
 * Returns a string value's lines, quoted, so an empty value or stray spaces still show without color. The quotes stay
 * unstyled, so they don't read as part of the value. A continuation line starts one column in, under the first line's
 * text rather than its opening quote.
 */
const quotedValueLines = (text: string) => {
  const lines = text.split("\n")
  const lastIndex = lines.length - 1
  return lines.map((line, index) => `${index === 0 ? "'" : " "}${styleValue(line)}${index === lastIndex ? "'" : ""}`)
}

/** Returns a comparison's `got` and `want` as the output shows them, one entry per line. */
const describeComparison = (comparison: Comparison) => {
  if (comparison.kind === "string")
    return { got: quotedValueLines(comparison.got), want: quotedValueLines(comparison.want) }
  if (comparison.kind === "boolean")
    return { got: [styleValue(String(comparison.got))], want: [styleValue(String(comparison.want))] }

  const want = comparison.want ? "exit code 0" : "a non-zero exit code"
  return { got: [styleExitCode(`exit code ${comparison.got}`)], want: [styleExitCode(want)] }
}

/**
 * Lists what a step found in the host's state when it still differed after the fix, one indented line each. The values
 * line up in one column, and a multi-line value's continuation lines line up under its first line.
 */
const formatStateFacts = (hostState: HostState) => {
  const { comparison, commandOutput } = hostState
  const { got, want } = describeComparison(comparison)

  const facts = [
    { label: "got", valueLines: got },
    { label: "want", valueLines: want },
  ]
  // Leave out empty stderr, so a quiet command shows only `got` and `want`.
  // Style each line of it, so a continuation line starts in the value's color too.
  const stderr = commandOutput?.stderr.trim()
  if (stderr)
    facts.push({ label: "stderr", valueLines: stderr.split("\n").map((stderrLine) => styleValue(stderrLine)) })

  // Line up every value in one column, past the longest label.
  const valueColumn = getMaxWidth(facts.map(({ label }) => `${label}: `))
  const continuationIndent = " ".repeat(valueColumn)

  return facts.flatMap(({ label, valueLines }) => {
    const labelText = padToWidth(`${label}: `, valueColumn)
    return valueLines.map((valueLine, index) => `${INDENT}${index === 0 ? labelText : continuationIndent}${valueLine}`)
  })
}

// Color the error red, but not the facts, because they describe the host's state, not the error itself.
const toFailureLine = (name: string, error: Error): StepLine => {
  const errorLines = messageChain(error)
    .split("\n")
    .map((errorLine) => pc.red(errorLine))

  const failedState = getFailedState(error)
  const factLines = failedState ? formatStateFacts(failedState) : []
  return { symbol: STEP_SYMBOLS.failed, name, errorLines: [...errorLines, ...factLines] }
}

/**
 * Returns the line a block shows for a step. A step that was already right, or only looked, shows only with `verbose`.
 * A step that never finished shows nothing.
 */
const toStepLines = (stepRecord: StepRecord, verbose: boolean): StepLine[] => {
  const { kind, details } = stepRecord
  // Style a read's or an inspect's name, because it's the command itself.
  const name = kind === "read" || kind === "inspect" ? styleValue(stepRecord.name) : stepRecord.name

  if (isErr(details)) return [toFailureLine(name, details)]
  if (details === undefined) return []

  const isQuiet = details.status === "unchanged" || details.status === "observed"
  if (isQuiet && !verbose) return []

  if (details.status === "waiting") {
    const neededNames = details.needs.map((neededName) => `'${neededName}'`)
    return [{ symbol: STEP_SYMBOLS.waiting, name, note: `needs ${neededNames.join(", ")}` }]
  }

  return [{ symbol: STEP_SYMBOLS[details.status], name }]
}

const formatStepLines = (stepLines: StepLine[]) => {
  // Line up every note in a block in one column, past the longest name that has one.
  const noteColumn = getMaxWidth(stepLines.filter(({ note }) => note).map(({ name }) => name))

  return stepLines.flatMap((stepLine) => {
    const { symbol, name, note, errorLines = [] } = stepLine

    // Dim the note, so the step's name stays the main thing on the line.
    const nameText = note ? `${padToWidth(name, noteColumn)}${COLUMN_GAP}${pc.dim(note)}` : name
    const headLine = `${INDENT}${symbol} ${nameText}`
    const indentedErrorLines = errorLines.map((errorLine) => `${ERROR_INDENT}${errorLine}`)

    return [headLine, ...indentedErrorLines]
  })
}

export interface FormatOptions {
  /** Shows every step, even the ones that didn't change anything. */
  verbose?: boolean
}

/**
 * Formats a host's block: its name, then a line for each step that changed, ran, waits, or failed. With `verbose`,
 * every step gets a line, and a host with no steps still gets a block, so it's clear the host ran.
 */
export const formatHostBlock = (hostReport: HostReport, formatOptions: FormatOptions = {}): string | undefined => {
  const { name, stepRecords, failure } = hostReport
  const { verbose = false } = formatOptions

  const stepLines = stepRecords.flatMap((stepRecord) => toStepLines(stepRecord, verbose))

  // Show a failure that no step owns, like the script throwing, after the steps.
  // Name it after the host's file, because the failure comes from the script itself.
  const isStepFailure = stepRecords.some(({ details }) => details === failure)
  // Italicize the file name, so it doesn't read as a step's name.
  const scriptName = pc.italic(`${name}${HOST_FILE_EXTENSION}`)
  if (failure && !isStepFailure) stepLines.push(toFailureLine(scriptName, failure))
  if (stepLines.length === 0 && verbose) return [pc.bold(name), `${INDENT}${pc.dim(pc.italic("no steps"))}`].join("\n")
  if (stepLines.length === 0) return

  return [pc.bold(name), ...formatStepLines(stepLines)].join("\n")
}

const formatHostStatus = (hostReport: HostReport) => {
  const { stepRecords, failure } = hostReport
  if (failure) return STATUS_COLORS.failed("failed")

  const statuses = stepRecords.map(({ details }) => (isErr(details) ? undefined : details?.status))
  // Count `ran` steps too, so the count matches the `~` and `>` lines in the block.
  const changeCount = statuses.filter((status) => status === "changed" || status === "ran").length
  const waitingCount = statuses.filter((status) => status === "waiting").length
  if (changeCount === 0 && waitingCount === 0) return STATUS_COLORS.unchanged("unchanged")

  // Color each count like its symbol, and leave the comma between them uncolored.
  const counts = []
  if (changeCount > 0) counts.push(STATUS_COLORS.changed(`${changeCount} ${changeCount === 1 ? "change" : "changes"}`))
  if (waitingCount > 0) counts.push(STATUS_COLORS.waiting(`${waitingCount} waiting`))
  return counts.join(", ")
}

/** Formats one line per host, with the plan reminder first when anything would change. */
export const formatSummary = (hostReports: HostReport[], mode: Mode) => {
  const nameWidth = getMaxWidth(hostReports.map(({ name }) => name))
  const hostLines = hostReports.map(
    (hostReport) => `${padToWidth(hostReport.name, nameWidth)}${COLUMN_GAP}${formatHostStatus(hostReport)}`,
  )

  const hasChangesPending = mode === "plan" && hostReports.some(({ stepRecords }) => hasPendingChange(stepRecords))
  // Dim the reminder, so the host lines stay the main thing in the summary.
  return [...(hasChangesPending ? [pc.dim(PLAN_REMINDER), ""] : []), ...hostLines].join("\n")
}
