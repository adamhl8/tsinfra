import type { ConvergePhase } from "#session/session.ts"
import { styleAccent, styleError, styleMuted, styleValue } from "#styles.ts"

const COMMAND_PROMPT = "$ "

/** Formats the `$ ` before a command in the accent color, so it only ever means that a command starts there. */
export const commandPromptElement = (): string => styleAccent(COMMAND_PROMPT)

/**
 * Formats the part of a step that ran a command in parentheses, like `(before)`, muted the way a step's kind is,
 * because it sorts the step's commands the way a kind sorts steps.
 */
export const phaseElement = (phase: ConvergePhase): string => styleMuted(`(${phase})`)

/**
 * Formats a command a step ran as its lines, muted so the commands read as background next to the details. Shows a
 * command tsinfra wrote by its label in angle brackets, like `<file details script>`, because its text is tsinfra's
 * code, not the script's. Angle brackets mark text that isn't shown, as in the record's `<content as base64>`.
 */
export const commandLineElements = ({ cmd, label }: { cmd: string; label?: string }): string[] => {
  const text = label === undefined ? cmd : `<${label}>`
  return text.split("\n").map((line) => styleMuted(line))
}

/** Formats a line of the command whose stderr explains a failure, in the value color, because it's the script's. */
export const failedCommandLineElement = (line: string): string => styleValue(line)

/** Formats a line a command printed to stdout, in the value color, because it came from the host. */
export const stdoutLineElement = (line: string): string => styleValue(line)

/** Formats a line a command printed to stderr in the error color. */
export const stderrLineElement = (line: string): string => styleError(line)
