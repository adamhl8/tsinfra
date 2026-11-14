import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import { formatCommands } from "#report/format/details/commands.ts"
import type { DiffLimits } from "#report/format/details/diff.ts"
import { formatDiff } from "#report/format/details/diff.ts"
import { formatEnsureValues } from "#report/format/details/ensure.ts"
import { formatFileValues } from "#report/format/details/file.ts"
import { formatFailureHint } from "#report/format/details/hint.ts"
import { formatLinkValues } from "#report/format/details/link.ts"
import { formatDetailNote } from "#report/format/details/note.ts"
import { formatOptions } from "#report/format/details/options.ts"
import { formatStderr } from "#report/format/details/stderr.ts"
import { formatWarning } from "#report/format/details/warning.ts"
import type { Detail } from "#report/host-block/host-block.ts"

export type { AlignedRow } from "#report/format/details/aligned-row.ts"
export type { DiffLimits } from "#report/format/details/diff.ts"
export { toDiffLimits } from "#report/format/details/diff.ts"

/**
 * A detail's rows, formatted, before layout positions them. A row is one or more lines. Aligned rows line up their
 * values in one column with the entry's other aligned rows, and unaligned rows, like a diff's lines, print as they
 * are.
 */
export type DetailRows = { kind: "aligned"; rows: AlignedRow[] } | { kind: "unaligned"; rows: string[] }

/** Formats a detail as the rows it prints as, aligned or not. Checks each kind in the order the details show. */
export const formatDetail = (detail: Detail, diffLimits: DiffLimits): DetailRows => {
  if (detail.kind === "options") return { kind: "unaligned", rows: formatOptions(detail.options) }
  if (detail.kind === "diff") return { kind: "unaligned", rows: formatDiff(detail.got, detail.want, diffLimits) }
  if (detail.kind === "fileComparisonValues") return { kind: "aligned", rows: formatFileValues(detail.values) }
  if (detail.kind === "linkComparisonValues") return { kind: "aligned", rows: formatLinkValues(detail.values) }
  if (detail.kind === "ensureComparisonValues") return formatEnsureValues(detail.values, diffLimits)
  if (detail.kind === "stderr") return { kind: "aligned", rows: formatStderr(detail.command, detail.stderr) }
  if (detail.kind === "note") return { kind: "unaligned", rows: [formatDetailNote(detail.note)] }
  if (detail.kind === "warning") return { kind: "unaligned", rows: [formatWarning(detail.warning)] }
  if (detail.kind === "commands") return { kind: "unaligned", rows: formatCommands(detail.commands) }
  if (detail.kind === "commandOutput") return { kind: "unaligned", rows: formatCommandOutputLines(detail.output, "") }

  return { kind: "unaligned", rows: [formatFailureHint(detail.hint)] }
}
