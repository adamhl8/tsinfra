import type { Body } from "#report/format/body.ts"
import { formatBody } from "#report/format/body.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { noteElement } from "#report/format/elements/asides.ts"
import { layoutHostBlock, layoutNoEntriesBlock } from "#report/format/layout.ts"
import { formatMessageEntry } from "#report/format/message.ts"
import type { StatusLine } from "#report/format/status-line.ts"
import { formatStatusLine } from "#report/format/status-line.ts"
import type { HostBlock, HostBlockEntry } from "#report/host-block.ts"
import { styleBold } from "#styles.ts"

// Re-export the summary's elements, because the summary is formatted outside this folder.

/** An entry with each piece formatted, before layout lines it up with the block's other entries. */
export type FormattedEntry = FormattedStatusLineEntry | FormattedMessageEntry

/** A status line entry with its status line and its body formatted. */
interface FormattedStatusLineEntry {
  kind: "statusLine"
  statusLine: StatusLine
  body: Body
}

/** A message entry formatted as one aligned row: its label, then its text. */
export interface FormattedMessageEntry {
  kind: "message"
  row: AlignedRow
}

/** Formats an entry's pieces, before layout: a status line entry's status line and body, or a message's row. */
const formatHostBlockEntry = (hostBlockEntry: HostBlockEntry, diffLimits: DiffLimits): FormattedEntry => {
  if (hostBlockEntry.kind === "message") return formatMessageEntry(hostBlockEntry)

  const statusLine = formatStatusLine(hostBlockEntry)
  const body = formatBody(hostBlockEntry, diffLimits)
  return { kind: "statusLine", statusLine, body }
}

/** Formats a block's host name in bold, so each block starts clearly. */
const hostNameElement = (name: string): string => styleBold(name)

/** Formats the note a block shows in place of entries when the host recorded none. */
const formatNoEntriesNote = (): string => noteElement("empty script")

/**
 * Formats a built host block as text: its name, then its entries laid out, or its "empty script" note. A diff, or an
 * `ensure`'s lines, stays within `diffLimits`.
 */
export const formatHostBlock = (hostBlock: HostBlock, diffLimits: DiffLimits): string => {
  const name = hostNameElement(hostBlock.name)
  if (hostBlock.kind === "noEntries") return layoutNoEntriesBlock(name, formatNoEntriesNote())

  const formattedEntries = hostBlock.entries.map((hostBlockEntry) => formatHostBlockEntry(hostBlockEntry, diffLimits))
  return layoutHostBlock(name, formattedEntries)
}
