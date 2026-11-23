import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import { formatCommands } from "#report/format/details/commands.ts"
import { formatFileDiff } from "#report/format/details/diff/file.ts"
import type { DiffLimits } from "#report/format/details/diff/limits.ts"
import { formatDirValues } from "#report/format/details/dir.ts"
import { formatEnsureValues } from "#report/format/details/ensure.ts"
import { formatFileValues } from "#report/format/details/file.ts"
import { formatFailureHint } from "#report/format/details/hint.ts"
import { formatLinkValues } from "#report/format/details/link.ts"
import { formatDetailNote } from "#report/format/details/note.ts"
import { formatOptions } from "#report/format/details/options.ts"
import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { formatStderr } from "#report/format/details/stderr.ts"
import { formatStepMessageRows } from "#report/format/details/step-messages.ts"
import { formatWarning } from "#report/format/details/warning.ts"
import type { Detail, StepMessage } from "#report/host-block.ts"

/**
 * A detail's rows, formatted, before layout positions them. A row is one or more lines. Aligned rows line up their
 * values in one column with the entry's other aligned rows. Unaligned rows, like a diff's lines, print as they are.
 */
export type DetailRows = { kind: "aligned"; rows: AlignedRow[] } | { kind: "unaligned"; rows: string[] }

/** What formatting an entry's details needs beyond each detail itself. */
export interface DetailContext {
  diffLimits: DiffLimits
  /** The entry's step messages that show among its commands, which the commands detail places. */
  stepMessagesAmongCommands: StepMessage[]
}

/** Formats a detail as the rows it prints as, aligned or not. Checks each kind in the order the details show. */
export const formatDetail = (ctx: DetailContext, detail: Detail): DetailRows => {
  const { diffLimits, stepMessagesAmongCommands } = ctx
  if (detail.kind === "options") return { kind: "unaligned", rows: formatOptions(detail.options) }
  if (detail.kind === "diff") return { kind: "unaligned", rows: formatFileDiff(detail.got, detail.want, diffLimits) }
  if (detail.kind === "fileComparisonValues") return { kind: "aligned", rows: formatFileValues(detail.values) }
  if (detail.kind === "linkComparisonValues") return { kind: "aligned", rows: formatLinkValues(detail.values) }
  if (detail.kind === "ensureComparisonValues") return formatEnsureValues(detail.values, diffLimits)
  if (detail.kind === "dirComparisonValues") return { kind: "aligned", rows: formatDirValues(detail.values) }
  if (detail.kind === "stderr") return { kind: "aligned", rows: formatStderr(detail.command, detail.stderr) }
  if (detail.kind === "note") return { kind: "unaligned", rows: [formatDetailNote(detail.note)] }
  if (detail.kind === "warning") return { kind: "unaligned", rows: [formatWarning(detail.warning)] }
  if (detail.kind === "stepMessages") return { kind: "unaligned", rows: formatStepMessageRows(detail.stepMessages) }
  if (detail.kind === "commands") {
    const hasPhaseHeadings = detail.phaseHeadings !== undefined
    const rows = formatCommands(detail.commands, hasPhaseHeadings, stepMessagesAmongCommands)
    return { kind: "unaligned", rows }
  }
  if (detail.kind === "commandOutput") return { kind: "unaligned", rows: formatCommandOutputLines(detail.output, "") }

  return { kind: "unaligned", rows: [formatFailureHint(detail.hint)] }
}
