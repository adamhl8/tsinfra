import type { Mode } from "#cli/program.ts"
import type { HostReport } from "#hosts/run.ts"
import { hasDrift } from "#hosts/run.ts"
import { COLUMN_GAP } from "#report/format.ts"
import { STATUS_STYLES, styleAside, styleWarning } from "#report/format/styles.ts"
import { getStepWarnings } from "#report/warnings.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

const formatHostStatus = (hostReport: HostReport): string => {
  if (!hostReport.started || hostReport.failure) return STATUS_STYLES.failed.color("failed")

  const { stepRecords } = hostReport

  const statuses = stepRecords.map(({ status }) => status)
  // Count `ran` steps too, so the count matches the `~` and `>` lines in the block.
  const changeCount = statuses.filter((status) => status === "changed" || status === "ran").length
  const waitingCount = statuses.filter((status) => status === "waiting").length
  // Count warnings too, so one isn't lost when the blocks have scrolled away.
  const warningCount = stepRecords.flatMap((stepRecord) => getStepWarnings(stepRecord)).length

  // Color each count like its symbol, and leave the comma between them uncolored.
  const counts: string[] = []
  if (changeCount > 0)
    counts.push(STATUS_STYLES.changed.color(`${changeCount} ${changeCount === 1 ? "change" : "changes"}`))
  if (waitingCount > 0) counts.push(STATUS_STYLES.waiting.color(`${waitingCount} waiting`))
  if (counts.length === 0) counts.push(STATUS_STYLES.unchanged.color("unchanged"))
  if (warningCount > 0) counts.push(styleWarning(`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`))
  return counts.join(", ")
}

/** Formats one line per host, with the plan reminder first when anything would change. */
export const formatSummary = (hostReports: HostReport[], mode: Mode): string => {
  const nameWidth = getMaxWidth(hostReports.map(({ name }) => name))
  const hostLines = hostReports.map(
    (hostReport) => `${padToWidth(hostReport.name, nameWidth)}${COLUMN_GAP}${formatHostStatus(hostReport)}`,
  )

  const hasAnyDrift = mode === "plan" && hostReports.some((hostReport) => hasDrift(hostReport))
  return [...(hasAnyDrift ? [styleAside(PLAN_REMINDER), ""] : []), ...hostLines].join("\n")
}
