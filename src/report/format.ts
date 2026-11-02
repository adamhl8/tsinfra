import pc from "picocolors"
import { isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import { HOST_FILE_EXTENSION } from "#hosts/discover.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasPendingChange } from "#hosts/run.ts"
import { formatComparison, formatStateFacts } from "#report/facts.ts"
import { STATUS_COLORS, STEP_SYMBOLS, styleNote, styleValue } from "#report/styles.ts"
import { getMaxWidth, padToWidth } from "#report/utils.ts"
import { getFailedState } from "#session/converge.ts"
import type { StepRecord } from "#session/step-records.ts"

const INDENT = "  "
const DETAIL_INDENT = INDENT.repeat(3)
const COLUMN_GAP = "   "
const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

export interface FormatOptions {
  /** Shows every step, even the ones that didn't change anything. */
  verbose?: boolean
}

interface StepLine {
  symbol: string
  name: string
  /** Text after the name, like the steps a waiting step needs. */
  note?: string
  /** Lines under the step line, like an error, or how a value would change. */
  detailLines?: string[]
}

// Color the error red, but not the facts, because they describe the host's state, not the error itself.
// Indent the facts under the error, so they read as its details.
const toFailureLine = (name: string, error: Error, formatOptions: FormatOptions): StepLine => {
  const errorLines = messageChain(error)
    .split("\n")
    .map((errorLine) => pc.red(errorLine))

  const failedState = getFailedState(error)
  const factLines = failedState
    ? formatStateFacts(failedState, formatOptions).map((factLine) => `${INDENT}${factLine}`)
    : []
  return { symbol: STEP_SYMBOLS.failed, name, detailLines: [...errorLines, ...factLines] }
}

/**
 * Returns the line a block shows for a step. A step that was already right, or only looked, shows only with `verbose`.
 * A step that never finished shows nothing.
 */
const toStepLines = (stepRecord: StepRecord, formatOptions: FormatOptions): StepLine[] => {
  const { kind, details } = stepRecord
  const { verbose = false } = formatOptions
  // Style a read's or an inspect's name, because it's the command itself.
  const name = kind === "read" || kind === "inspect" ? styleValue(stepRecord.name) : stepRecord.name

  if (isErr(details)) return [toFailureLine(name, details, formatOptions)]
  if (details === undefined) return []

  const isQuiet = details.status === "unchanged" || details.status === "observed"
  if (isQuiet && !verbose) return []

  if (details.status === "waiting") {
    const neededNames = details.needs.map((neededName) => `'${neededName}'`)
    return [{ symbol: STEP_SYMBOLS.waiting, name, note: `needs ${neededNames.join(", ")}` }]
  }

  // Show how a string value would change, because the step's name doesn't say.
  // A boolean or an exit code needs no detail, because the name already says what yes and no mean.
  if (details.status === "changed" && details.comparison.kind === "string") {
    const detailLines = formatComparison(details.comparison, formatOptions)
    return [{ symbol: STEP_SYMBOLS.changed, name, detailLines }]
  }

  return [{ symbol: STEP_SYMBOLS[details.status], name }]
}

const formatStepLines = (stepLines: StepLine[]) => {
  // Line up every note in a block in one column, past the longest name that has one.
  const noteColumn = getMaxWidth(stepLines.filter(({ note }) => note).map(({ name }) => name))

  return stepLines.flatMap((stepLine) => {
    const { symbol, name, note, detailLines = [] } = stepLine

    // Dim the note, so the step's name stays the main thing on the line.
    const nameText = note ? `${padToWidth(name, noteColumn)}${COLUMN_GAP}${pc.dim(note)}` : name
    const headLine = `${INDENT}${symbol} ${nameText}`
    const indentedDetailLines = detailLines.map((detailLine) => `${DETAIL_INDENT}${detailLine}`)

    return [headLine, ...indentedDetailLines]
  })
}

/**
 * Formats a host's block: its name, then a line for each step that changed, ran, waits, or failed. With `verbose`,
 * every step gets a line, and a host with no steps still gets a block, so it's clear the host ran.
 */
export const formatHostBlock = (hostReport: HostReport, formatOptions: FormatOptions = {}): string | undefined => {
  const { name, stepRecords, failure } = hostReport
  const { verbose = false } = formatOptions

  const stepLines = stepRecords.flatMap((stepRecord) => toStepLines(stepRecord, formatOptions))

  // Show a failure that no step owns, like the script throwing, after the steps.
  const isStepFailure = stepRecords.some(({ details }) => details === failure)
  if (failure && !isStepFailure) {
    // Name it after the host's file, in italics, because it comes from the script, not a step.
    const scriptName = pc.italic(`${name}${HOST_FILE_EXTENSION}`)
    stepLines.push(toFailureLine(scriptName, failure, formatOptions))
  }

  if (stepLines.length === 0 && verbose) return [pc.bold(name), `${INDENT}${styleNote("no steps")}`].join("\n")
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
