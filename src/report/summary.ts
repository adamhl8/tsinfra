import type { Mode } from "#mode.ts"
import { planReminderElement } from "#report/format/elements/asides.ts"
import { statusTextElement, warningCountElement } from "#report/format/elements/summary.ts"
import { COLUMN_GAP } from "#report/format/layout.ts"
import type { EntryStatus, HostBlock, HostBlockEntry, StatusLineEntry } from "#report/host-block.ts"
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

/** Reports whether any status line entry in the block has one of `statuses`, because a message has no status. */
const hasStatus = (hostBlock: HostBlock, statuses: EntryStatus[]): boolean =>
  getEntries(hostBlock).some(
    (hostBlockEntry) => hostBlockEntry.kind !== "hostMessage" && statuses.includes(hostBlockEntry.status),
  )

/** Reports whether the host failed, which the block shows as a `failed` entry. */
export const hasFailed = (hostBlock: HostBlock): boolean => hasStatus(hostBlock, ["failed"])

/**
 * Reports whether a step found the host different from the script, which is drift, and makes `plan` exit 2. A follow-up
 * that only an open change triggered counts too, because nothing else in the pass explains it, and `apply` would run
 * it.
 */
export const hasDrift = (hostBlock: HostBlock): boolean => hasStatus(hostBlock, ["changed", "ranFromOpenChanges"])

/**
 * Returns how many distinct warning messages a step's shown details hold, so one it logged before and after the fix
 * counts once, wherever it shows.
 */
const countStepWarningMessages = (statusLineEntry: StatusLineEntry): number => {
  const stepMessages = statusLineEntry.details.flatMap((detail) =>
    detail.kind === "stepMessages" ? detail.stepMessages : [],
  )
  const warningTexts = stepMessages.flatMap(({ messageKind, text }) => (messageKind === "warn" ? [text] : []))
  return new Set(warningTexts).size
}

const formatHostStatus = (hostBlock: HostBlock): string => {
  if (hasFailed(hostBlock)) return statusTextElement("failed", "failed")

  // Count warnings too, a step's and a message's, so one isn't lost when the blocks have scrolled away.
  let changeCount = 0
  let waitingCount = 0
  let warningCount = 0
  for (const hostBlockEntry of getEntries(hostBlock)) {
    if (hostBlockEntry.kind === "hostMessage") {
      if (hostBlockEntry.messageKind === "warn") warningCount += 1
      continue
    }

    const { status, details } = hostBlockEntry
    if (IN_CHANGE_COUNT[status]) changeCount += 1
    if (status === "waiting") waitingCount += 1
    warningCount += details.filter(({ kind }) => kind === "warning").length + countStepWarningMessages(hostBlockEntry)
  }

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
