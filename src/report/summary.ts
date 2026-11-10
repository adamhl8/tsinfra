import { hasDrift } from "#hosts/hosts.ts"
import type { Mode } from "#mode.ts"
import { COLUMN_GAP } from "#report/format/format.ts"
import { getStepWarnings } from "#report/warnings.ts"
import type { HostRecord } from "#session/session.ts"
import { STATUS_STYLES, styleAside, styleWarning } from "#styles.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

const formatHostStatus = (hostRecord: HostRecord): string => {
  if (hostRecord.failure) return STATUS_STYLES.failed.color("failed")

  const { stepRecords } = hostRecord

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
export const formatSummary = (hostRecords: HostRecord[], mode: Mode): string => {
  const nameWidth = getMaxWidth(hostRecords.map(({ name }) => name))
  const hostLines = hostRecords.map(
    (hostRecord) => `${padToWidth(hostRecord.name, nameWidth)}${COLUMN_GAP}${formatHostStatus(hostRecord)}`,
  )

  const hasAnyDrift = mode === "plan" && hostRecords.some((hostRecord) => hasDrift(hostRecord))
  return [...(hasAnyDrift ? [styleAside(PLAN_REMINDER), ""] : []), ...hostLines].join("\n")
}
