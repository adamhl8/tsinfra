import type { AlignedRow } from "#report/format/details/aligned-row.ts"
import { formatAlignedRow } from "#report/format/details/aligned-row.ts"
import { failedCommandLineElement, stderrLineElement } from "#report/format/elements/elements.ts"
import { splitNonEmptyLines } from "#utils.ts"

/** Formats a command's stderr as two rows, a `command:` row and a `stderr:` row, so each label names its own value. */
export const formatStderr = (command: string, stderr: string): AlignedRow[] => {
  const commandLines = command.split("\n").map((commandLine) => failedCommandLineElement(commandLine))
  const stderrLines = splitNonEmptyLines(stderr).map((stderrLine) => stderrLineElement(stderrLine))
  return [formatAlignedRow("command", commandLines), formatAlignedRow("stderr", stderrLines)]
}
