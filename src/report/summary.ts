import type { Mode } from "#mode.ts"
import { COLUMN_GAP, planReminderElement, statusTextElement, warningCountElement } from "#report/format/format.ts"
import type { HostBlock, HostBlockEntry } from "#report/host-block/host-block.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

/** Returns `count` with its noun, like `1 change` or `2 changes`. */
const countOf = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

const getEntries = (hostBlock: HostBlock): HostBlockEntry[] => (hostBlock.kind === "entries" ? hostBlock.entries : [])

/** Reports whether the host failed, which the block shows as a `failed` entry. */
export const hasFailed = (hostBlock: HostBlock): boolean =>
  getEntries(hostBlock).some(({ status }) => status === "failed")

/** Reports whether a step found the host different from the script, which is drift, and makes `plan` exit 2. */
export const hasDrift = (hostBlock: HostBlock): boolean =>
  getEntries(hostBlock).some(({ status }) => status === "changed")

const formatHostStatus = (hostBlock: HostBlock): string => {
  if (hasFailed(hostBlock)) return statusTextElement("failed", "failed")

  const entries = getEntries(hostBlock)
  const statuses = entries.map(({ status }) => status)

  // Count `ran` steps too, so the count matches the `~` and `>` lines in the block.
  const changeCount = statuses.filter((status) => status === "changed" || status === "ran").length
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

/** Renders one line per host from its block, with the plan reminder first when anything would change. */
export const renderSummary = (hostBlocks: HostBlock[], mode: Mode): string => {
  const nameWidth = getMaxWidth(hostBlocks.map(({ name }) => name))
  const hostLines = hostBlocks.map(
    (hostBlock) => `${padToWidth(hostBlock.name, nameWidth)}${COLUMN_GAP}${formatHostStatus(hostBlock)}`,
  )

  const hasAnyDrift = mode === "plan" && hostBlocks.some((hostBlock) => hasDrift(hostBlock))
  return [...(hasAnyDrift ? [planReminderElement(PLAN_REMINDER), ""] : []), ...hostLines].join("\n")
}
