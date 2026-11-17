import type { Body } from "#report/format/body.ts"
import { formatBody } from "#report/format/body.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { noteElement } from "#report/format/elements/messages.ts"
import { layoutHostBlock, layoutNoStepsBlock } from "#report/format/layout.ts"
import type { StatusLine } from "#report/format/status-line.ts"
import { formatStatusLine } from "#report/format/status-line.ts"
import type { HostBlock, HostBlockEntry } from "#report/host-block.ts"
import { styleBold } from "#styles.ts"

// Re-export the summary's elements, because the summary is formatted outside this folder.

/** An entry with each piece formatted, before layout lines it up with the block's other entries. */
export interface FormattedEntry {
  statusLine: StatusLine
  body: Body
}

/** Formats each entry's status line and body, before layout. */
const formatHostBlockEntries = (hostBlockEntries: HostBlockEntry[], diffLimits: DiffLimits): FormattedEntry[] =>
  hostBlockEntries.map((hostBlockEntry) => ({
    statusLine: formatStatusLine(hostBlockEntry),
    body: formatBody(hostBlockEntry, diffLimits),
  }))

/** Formats a block's host name in bold, so each block starts clearly. */
const hostNameElement = (name: string): string => styleBold(name)

/** Formats the note a block shows in place of entries when the host's script made no steps. */
const formatNoStepsNote = (): string => noteElement("no steps")

/**
 * Formats a built host block as text: its name, then its entries laid out, or its "no steps" note. A diff, or an
 * `ensure`'s lines, stays within `diffLimits`.
 */
export const formatHostBlock = (hostBlock: HostBlock, diffLimits: DiffLimits): string => {
  const name = hostNameElement(hostBlock.name)
  if (hostBlock.kind === "noSteps") return layoutNoStepsBlock(name, formatNoStepsNote())

  return layoutHostBlock(name, formatHostBlockEntries(hostBlock.entries, diffLimits))
}
