import type { Body } from "#report/format/body.ts"
import { formatBody } from "#report/format/body.ts"
import { layoutHostBlock, layoutNoStepsBlock } from "#report/format/layout.ts"
import type { StatusLine } from "#report/format/status-line.ts"
import { formatStatusLine } from "#report/format/status-line.ts"
import type { HostBlock, HostBlockEntry } from "#report/host-block.ts"
import type { ReportOptions } from "#report/report.ts"
import { styleHostName, styleNote } from "#styles.ts"

export { COLUMN_GAP } from "#report/format/layout.ts"

/** An entry with each piece formatted, before layout lines it up with the block's other entries. */
export interface FormattedEntry {
  statusLine: StatusLine
  body: Body
}

/** Formats each entry's status line and body, before layout. */
const formatHostBlockEntries = (hostBlockEntries: HostBlockEntry[], reportOptions: ReportOptions): FormattedEntry[] =>
  hostBlockEntries.map((hostBlockEntry) => ({
    statusLine: formatStatusLine(hostBlockEntry),
    body: formatBody(hostBlockEntry, reportOptions),
  }))

/** Formats a built host block as text: its name, then its entries laid out, or its "no steps" note. */
export const formatHostBlock = (hostBlock: HostBlock, reportOptions: ReportOptions): string => {
  const name = styleHostName(hostBlock.name)
  if (hostBlock.kind === "noSteps") return layoutNoStepsBlock(name, styleNote("no steps"))

  return layoutHostBlock(name, formatHostBlockEntries(hostBlock.entries, reportOptions))
}
