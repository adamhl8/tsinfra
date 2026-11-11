import type { Mode } from "#mode.ts"
import { COLUMN_GAP } from "#report/format/format.ts"
import type { HostBlock, HostBlockEntry } from "#report/host-block.ts"
import { STATUS_STYLES, styleAside, styleWarning } from "#styles.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

const PLAN_REMINDER = "Steps after a change were checked without that change, so apply may differ."

const getEntries = (hostBlock: HostBlock): HostBlockEntry[] => (hostBlock.kind === "entries" ? hostBlock.entries : [])

/** Reports whether the host failed, which the block shows as a `failed` entry. */
export const hasFailed = (hostBlock: HostBlock): boolean =>
  getEntries(hostBlock).some(({ status }) => status === "failed")

/** Reports whether a step found the host different from the script, which is drift, and makes `plan` exit 2. */
export const hasDrift = (hostBlock: HostBlock): boolean =>
  getEntries(hostBlock).some(({ status }) => status === "changed")

const formatHostStatus = (hostBlock: HostBlock): string => {
  if (hasFailed(hostBlock)) return STATUS_STYLES.failed.color("failed")

  const entries = getEntries(hostBlock)
  const statuses = entries.map(({ status }) => status)

  // Count `ran` steps too, so the count matches the `~` and `>` lines in the block.
  const changeCount = statuses.filter((status) => status === "changed" || status === "ran").length
  const waitingCount = statuses.filter((status) => status === "waiting").length
  // Count warnings too, so one isn't lost when the blocks have scrolled away.
  const warningCount = entries.flatMap(({ details }) => details).filter(({ kind }) => kind === "warning").length

  // Color each count like its symbol, and leave the comma between them uncolored.
  const counts: string[] = []
  if (changeCount > 0)
    counts.push(STATUS_STYLES.changed.color(`${changeCount} ${changeCount === 1 ? "change" : "changes"}`))
  if (waitingCount > 0) counts.push(STATUS_STYLES.waiting.color(`${waitingCount} waiting`))
  if (counts.length === 0) counts.push(STATUS_STYLES.unchanged.color("unchanged"))
  if (warningCount > 0) counts.push(styleWarning(`${warningCount} ${warningCount === 1 ? "warning" : "warnings"}`))
  return counts.join(", ")
}

/** Renders one line per host from its block, with the plan reminder first when anything would change. */
export const renderSummary = (hostBlocks: HostBlock[], mode: Mode): string => {
  const nameWidth = getMaxWidth(hostBlocks.map(({ name }) => name))
  const hostLines = hostBlocks.map(
    (hostBlock) => `${padToWidth(hostBlock.name, nameWidth)}${COLUMN_GAP}${formatHostStatus(hostBlock)}`,
  )

  const hasAnyDrift = mode === "plan" && hostBlocks.some((hostBlock) => hasDrift(hostBlock))
  return [...(hasAnyDrift ? [styleAside(PLAN_REMINDER), ""] : []), ...hostLines].join("\n")
}
