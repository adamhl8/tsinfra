import type { Mode } from "#mode.ts"
import { planReminderElement } from "#report/format/elements/messages.ts"
import { statusTextElement, warningCountElement } from "#report/format/elements/summary.ts"
import { COLUMN_GAP } from "#report/format/layout.ts"
import type { EntryStatus, HostBlock, HostBlockEntry } from "#report/host-block.ts"
import { countOf, getMaxWidth, padToWidth } from "#utils.ts"

const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

// Count triggered runs too, so the count matches the `~` and `>` lines in the block.
const IN_CHANGE_COUNT: Record<EntryStatus, boolean> = {
  unchanged: false,
  observed: false,
  changed: true,
  ran: true,
  ranAlways: true,
  ranFromOpenChanges: true,
  waiting: false,
  failed: false,
  resume: false,
}

const getEntries = (hostBlock: HostBlock): HostBlockEntry[] => (hostBlock.kind === "entries" ? hostBlock.entries : [])

/** Reports whether the host failed, which the block shows as a `failed` entry. */
export const hasFailed = (hostBlock: HostBlock): boolean =>
  getEntries(hostBlock).some(({ status }) => status === "failed")

/**
 * Reports whether a step found the host different from the script, which is drift, and makes `plan` exit 2. A follow-up
 * that only an open change triggered counts too, because nothing else in the pass explains it, and `apply` would run
 * it.
 */
export const hasDrift = (hostBlock: HostBlock): boolean =>
  getEntries(hostBlock).some(({ status }) => status === "changed" || status === "ranFromOpenChanges")

const formatHostStatus = (hostBlock: HostBlock): string => {
  if (hasFailed(hostBlock)) return statusTextElement("failed", "failed")

  const entries = getEntries(hostBlock)
  const statuses = entries.map(({ status }) => status)

  const changeCount = statuses.filter((status) => IN_CHANGE_COUNT[status]).length
  const waitingCount = statuses.filter((status) => status === "waiting").length
  // Count warnings too, so one isn't lost when the blocks have scrolled away.
  const warningCount = entries.flatMap(({ details }) => details).filter(({ kind }) => kind === "warning").length

  // Leave the comma between the counts unstyled.
  const counts: string[] = []
  if (changeCount > 0) counts.push(statusTextElement("changed", countOf(changeCount, "change", "changes")))
  if (waitingCount > 0) counts.push(statusTextElement("waiting", `${waitingCount} waiting`))
  if (counts.length === 0) counts.push(statusTextElement("unchanged", "unchanged"))
  if (warningCount > 0) counts.push(warningCountElement(countOf(warningCount, "warning", "warnings")))
  return counts.join(", ")
}

/**
 * Renders one line per host from its block from `toShownHostBlock`, with the plan reminder first when anything would
 * change. Each count is of what the block shows, so it matches the lines above it.
 */
export const renderSummary = (hostBlocks: HostBlock[], mode: Mode): string => {
  const nameWidth = getMaxWidth(hostBlocks.map(({ name }) => name))
  const hostLines = hostBlocks.map(
    (hostBlock) => `${padToWidth(hostBlock.name, nameWidth)}${COLUMN_GAP}${formatHostStatus(hostBlock)}`,
  )

  // Check the shown blocks for drift, because a step with drift shows at every level.
  const hasAnyDrift = mode === "plan" && hostBlocks.some((hostBlock) => hasDrift(hostBlock))
  return [...(hasAnyDrift ? [planReminderElement(PLAN_REMINDER), ""] : []), ...hostLines].join("\n")
}
