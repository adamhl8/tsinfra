import pc from "picocolors"
import { isErr, messageChain } from "ts-explicit-errors"

import type { Mode } from "#cli/program.ts"
import { HOST_FILE_EXTENSION } from "#hosts/discover.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasPendingChange } from "#hosts/run.ts"
import { getMaxWidth, padToWidth } from "#report/utils.ts"
import type { StepRecord } from "#session/step-records.ts"
import type { StepDetails } from "#session/step.ts"

const STEP_INDENT = "  "
const ERROR_INDENT = "      "
const COLUMN_GAP = "   "
const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

type StepStatus = StepDetails["status"] | "failed"

const STEP_SYMBOLS: Record<StepStatus, string> = {
  ok: pc.green("="),
  changed: pc.yellow("~"),
  ran: pc.yellow(">"),
  failed: pc.red("!"),
}

interface StepLine {
  symbol: string
  name: string
  errorLines?: string[]
}

const LEADING_WHITESPACE = /^\s/v

// Leave indented lines plain, because they are facts a check found, like `read` and `want`, not the error itself.
const colorErrorLine = (errorLine: string) => (LEADING_WHITESPACE.test(errorLine) ? errorLine : pc.red(errorLine))

const toFailureLine = (name: string, error: Error): StepLine => ({
  symbol: STEP_SYMBOLS.failed,
  name,
  errorLines: messageChain(error)
    .split("\n")
    .map((errorLine) => colorErrorLine(errorLine)),
})

/** Returns the line a block shows for a step, or none for a step that was already right or never finished. */
const toStepLines = (stepRecord: StepRecord): StepLine[] => {
  const { name, details } = stepRecord

  if (isErr(details)) return [toFailureLine(name, details)]
  if (details?.status === "changed" || details?.status === "ran")
    return [{ symbol: STEP_SYMBOLS[details.status], name }]
  return []
}

const formatStepLines = (stepLines: StepLine[]) =>
  stepLines.flatMap(({ symbol, name, errorLines = [] }) => [
    `${STEP_INDENT}${symbol} ${name}`,
    ...errorLines.map((errorLine) => `${ERROR_INDENT}${errorLine}`),
  ])

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
  if (changeCount === 0) return pc.green("ok")

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
