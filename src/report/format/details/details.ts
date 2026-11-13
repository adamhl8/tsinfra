import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import { formatCommands } from "#report/format/details/commands.ts"
import type { DiffLimits } from "#report/format/details/diff.ts"
import { formatDiff } from "#report/format/details/diff.ts"
import { formatEnsureValues } from "#report/format/details/ensure.ts"
import { formatFileValues } from "#report/format/details/file.ts"
import { formatLinkValues } from "#report/format/details/link.ts"
import { formatOptions } from "#report/format/details/options.ts"
import type { Detail, StepWarning } from "#report/host-block/host-block.ts"
import { styleError, styleHint, styleNote, styleValue, styleWarning } from "#styles.ts"
import { splitNonEmptyLines } from "#utils.ts"

export type { AlignedRow } from "#report/format/details/aligned-row.ts"
export type { DiffLimits } from "#report/format/details/diff.ts"
export { DEFAULT_DIFF_LIMITS } from "#report/format/details/diff.ts"

/**
 * A detail's rows, formatted, before layout positions them. A row is one or more lines. Aligned rows line up their
 * values in one column with the entry's other aligned rows, and unaligned rows, like a diff's lines, print as they
 * are.
 */
export type DetailRows = { kind: "aligned"; rows: AlignedRow[] } | { kind: "unaligned"; rows: string[] }

/**
 * Formats a warning, like `warning: nothing exists at target -> /x`, with the value it's about after its words. Colors
 * only the label and the value, so the words read like the rest of the details.
 */
const formatWarning = (warning: StepWarning): string => {
  const { text, value } = warning
  const valueText = value === undefined ? "" : ` ${styleValue(value)}`
  return `${styleWarning("warning:")} ${text}${valueText}`
}

/** Formats a command's stderr as two rows, a `command:` row and a `stderr:` row, so each label names its own value. */
const formatStderr = (command: string, stderr: string): AlignedRow[] => {
  const commandLines = command.split("\n").map((commandLine) => styleValue(commandLine))
  // Color stderr like an error, so it stands apart from its command.
  const stderrLines = splitNonEmptyLines(stderr).map((stderrLine) => styleError(stderrLine))
  return [formatAlignedRow("command", commandLines), formatAlignedRow("stderr", stderrLines)]
}

/** Formats a detail as the rows it prints as, aligned or not. Checks each kind in the order the details show. */
export const formatDetail = (detail: Detail, diffLimits: DiffLimits | undefined): DetailRows => {
  if (detail.kind === "options") return { kind: "unaligned", rows: formatOptions(detail.options) }
  if (detail.kind === "diff") return { kind: "unaligned", rows: formatDiff(detail.got, detail.want, diffLimits) }
  if (detail.kind === "fileComparisonValues") return { kind: "aligned", rows: formatFileValues(detail.values) }
  if (detail.kind === "linkComparisonValues") return { kind: "aligned", rows: formatLinkValues(detail.values) }
  if (detail.kind === "ensureComparisonValues") return { kind: "aligned", rows: formatEnsureValues(detail.values) }
  if (detail.kind === "stderr") return { kind: "aligned", rows: formatStderr(detail.command, detail.stderr) }
  if (detail.kind === "note") return { kind: "unaligned", rows: [styleNote(detail.text)] }
  if (detail.kind === "warning") return { kind: "unaligned", rows: [formatWarning(detail.warning)] }
  if (detail.kind === "commands") return { kind: "unaligned", rows: formatCommands(detail.commands) }
  if (detail.kind === "commandOutput") return { kind: "unaligned", rows: formatCommandOutputLines(detail.output, "") }

  return { kind: "unaligned", rows: [styleHint(detail.text)] }
}
