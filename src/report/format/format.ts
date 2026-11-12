import type { Body } from "#report/format/body.ts"
import { formatBody } from "#report/format/body.ts"
import type { DiffLimits } from "#report/format/details/details.ts"
import { layoutHostBlock, layoutNoStepsBlock } from "#report/format/layout.ts"
import type { StatusLine } from "#report/format/status-line.ts"
import { formatStatusLine } from "#report/format/status-line.ts"
import type { HostBlock, HostBlockEntry } from "#report/host-block/host-block.ts"
import { styleHostName, styleNote } from "#styles.ts"

export type { DiffLimits } from "#report/format/details/details.ts"
export { DEFAULT_DIFF_LIMITS } from "#report/format/details/details.ts"
export { COLUMN_GAP } from "#report/format/layout.ts"

/** An entry with each piece formatted, before layout lines it up with the block's other entries. */
export interface FormattedEntry {
  statusLine: StatusLine
  body: Body
}

/** Formats each entry's status line and body, before layout. */
const formatHostBlockEntries = (
  hostBlockEntries: HostBlockEntry[],
  diffLimits: DiffLimits | undefined,
): FormattedEntry[] =>
  hostBlockEntries.map((hostBlockEntry) => ({
    statusLine: formatStatusLine(hostBlockEntry),
    body: formatBody(hostBlockEntry, diffLimits),
  }))

/**
 * Formats a built host block as text: its name, then its entries laid out, or its "no steps" note. A diff stays within
 * `diffLimits`, or shows in full without them.
 */
export const formatHostBlock = (hostBlock: HostBlock, diffLimits: DiffLimits | undefined): string => {
  const name = styleHostName(hostBlock.name)
  if (hostBlock.kind === "noSteps") return layoutNoStepsBlock(name, styleNote("no steps"))

  return layoutHostBlock(name, formatHostBlockEntries(hostBlock.entries, diffLimits))
}
