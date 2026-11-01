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

const STEP_SYMBOLS: Record<StepStatus, string> = {
  unchanged: pc.green("="),
  changed: pc.yellow("~"),
  ran: pc.yellow(">"),
  failed: pc.red("!"),
}

interface StepLine {
  symbol: string
  name: string
  errorLines?: string[]
}

// Quote a string value, so an empty one or one with stray spaces is visible in the output.
const quote = (text: string) => `'${text}'`

/** Returns a comparison's `got` and `want` as the output shows them. */
const describeComparison = (comparison: Comparison) => {
  if (comparison.kind === "string") return { got: quote(comparison.got), want: quote(comparison.want) }
  if (comparison.kind === "boolean") return { got: String(comparison.got), want: String(comparison.want) }
  return { got: `exit code ${comparison.got}`, want: comparison.want ? "exit code 0" : "a non-zero exit code" }
}

/**
 * Lists what a step found in the host's state when it still differed after the fix, one indented line each. A
 * multi-line fact keeps the same indent.
 */
const formatStateFacts = (hostState: HostState) => {
  const { comparison, commandResult } = hostState
  const { got, want } = describeComparison(comparison)

  const facts = [`got: ${got}`, `want: ${want}`]
  // Leave out empty stderr, so a quiet command shows only `got` and `want`.
  const stderr = commandResult?.stderr.trim()
  if (stderr) facts.push(`stderr: ${stderr}`)

  const factLines = facts.flatMap((fact) => fact.split("\n"))
  return factLines.map((factLine) => `${INDENT}${factLine}`)
}

// Color the error red, and leave the facts plain, because they describe the host's state, not the error itself.
const toFailureLine = (name: string, error: Error): StepLine => {
  const errorLines = messageChain(error)
    .split("\n")
    .map((errorLine) => pc.red(errorLine))

  const failedState = getFailedState(error)
  const factLines = failedState ? formatStateFacts(failedState) : []
  return { symbol: STEP_SYMBOLS.failed, name, errorLines: [...errorLines, ...factLines] }
}

/** Returns the line a block shows for a step, or none for a step that was already right or never finished. */
const toStepLines = (stepRecord: StepRecord): StepLine[] => {
  const { name, details } = stepRecord

  if (isErr(details)) return [toFailureLine(name, details)]

  // Leave out a step that never finished, and one that was already right, which only `--verbose` will show.
  if (details === undefined || details.status === "unchanged") return []

  return [{ symbol: STEP_SYMBOLS[details.status], name }]
}

const formatStepLines = (stepLines: StepLine[]) =>
  stepLines.flatMap((stepLine) => {
    const { symbol, name, errorLines = [] } = stepLine

    const headLine = `${INDENT}${symbol} ${name}`
    const indentedErrorLines = errorLines.map((errorLine) => `${ERROR_INDENT}${errorLine}`)

    return [headLine, ...indentedErrorLines]
  })

/** Formats a host's block: its name, then a line for each step that changed, ran, or failed. */
export const formatHostBlock = (hostReport: HostReport): string | undefined => {
  const { name, stepRecords, failure } = hostReport

  const stepLines = stepRecords.flatMap((stepRecord) => toStepLines(stepRecord))

  // Show a failure that no step owns, like the script throwing, after the steps.
  // Name it after the host's file, because the failure comes from the script itself.
  const isStepFailure = stepRecords.some(({ details }) => details === failure)
  if (failure && !isStepFailure) stepLines.push(toFailureLine(`${name}${HOST_FILE_EXTENSION}`, failure))
  if (stepLines.length === 0) return

  return [pc.bold(name), ...formatStepLines(stepLines)].join("\n")
}

const formatHostStatus = (hostReport: HostReport) => {
  const { stepRecords, failure } = hostReport
  if (failure) return pc.red("failed")

  // Count `ran` steps too, so the count matches the `~` and `>` lines in the block.
  const changeCount = stepRecords.filter(({ details }) => !isErr(details) && details?.changed).length
  if (changeCount === 0) return pc.green("unchanged")

  return pc.yellow(`${changeCount} ${changeCount === 1 ? "change" : "changes"}`)
}

/** Formats one line per host, with the plan reminder first when anything would change. */
export const formatSummary = (hostReports: HostReport[], mode: Mode) => {
  const nameWidth = getMaxWidth(hostReports.map(({ name }) => name))
  const hostLines = hostReports.map(
    (hostReport) => `${padToWidth(hostReport.name, nameWidth)}${COLUMN_GAP}${formatHostStatus(hostReport)}`,
  )

  const hasChangesPending = mode === "plan" && hostReports.some(({ stepRecords }) => hasPendingChange(stepRecords))
  return [...(hasChangesPending ? [PLAN_REMINDER, ""] : []), ...hostLines].join("\n")
}
