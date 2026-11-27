import type { Body } from "#report/format/body.ts"
import { formatBody } from "#report/format/body.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { noteElement } from "#report/format/elements/asides.ts"
import { formatHostMessageEntry } from "#report/format/host-message.ts"
import { formatHostWarning } from "#report/format/host-warning.ts"
import { layoutHostBlock } from "#report/format/layout.ts"
import type { StatusLine } from "#report/format/status-line.ts"
import { formatStatusLine } from "#report/format/status-line.ts"
import type { HostBlock, HostBlockEntry, HostNote } from "#report/host-block.ts"
import { styleBold } from "#styles.ts"

/** A host block with each piece formatted, before layout puts them on lines. */
export interface FormattedHostBlock {
  name: string
  warnings: FormattedHostWarning[]
  note: string | undefined
  entries: FormattedEntry[]
}

/** A host warning's line, and the hint under it. */
export interface FormattedHostWarning {
  line: string
  hint: string
}

/** An entry with each piece formatted, before layout lines it up with the block's other entries. */
export type FormattedEntry = FormattedStatusLineEntry | FormattedHostMessageEntry

/** A status line entry with its status line and its body formatted. */
interface FormattedStatusLineEntry {
  kind: "statusLine"
  statusLine: StatusLine
  body: Body
}

/** A host message entry formatted as one aligned row: its label, then its text. */
export interface FormattedHostMessageEntry {
  kind: "hostMessage"
  row: AlignedRow
}

/** Formats an entry's pieces, before layout: a status line entry's status line and body, or a host message's row. */
const formatHostBlockEntry = (hostBlockEntry: HostBlockEntry, diffLimits: DiffLimits): FormattedEntry => {
  if (hostBlockEntry.kind === "hostMessage") return formatHostMessageEntry(hostBlockEntry)

  const statusLine = formatStatusLine(hostBlockEntry)
  const body = formatBody(hostBlockEntry, diffLimits)
  return { kind: "statusLine", statusLine, body }
}

/** Formats a block's host name in bold, so each block starts clearly. */
const hostNameElement = (name: string): string => styleBold(name)

const HOST_NOTE_WORDS: Record<HostNote["kind"], string> = {
  noEntries: "empty script",
  unfinishedApply: "an earlier apply didn't finish, so follow-ups that didn't complete still trigger",
}

/** Formats the note a block shows before its entries. */
const formatHostNote = (hostNote: HostNote): string => noteElement(HOST_NOTE_WORDS[hostNote.kind])

/**
 * Formats a built host block as text: its name, then its warnings, its note, and its entries laid out. A diff, or an
 * `ensure`'s lines, stays within `diffLimits`.
 */
export const formatHostBlock = (hostBlock: HostBlock, diffLimits: DiffLimits): string => {
  const name = hostNameElement(hostBlock.name)
  const warnings = hostBlock.warnings.map((hostWarning) => formatHostWarning(hostWarning))
  const note = hostBlock.note && formatHostNote(hostBlock.note)
  const entries = hostBlock.entries.map((hostBlockEntry) => formatHostBlockEntry(hostBlockEntry, diffLimits))
  return layoutHostBlock({ name, warnings, note, entries })
}
