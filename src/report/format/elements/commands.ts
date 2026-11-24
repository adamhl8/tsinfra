import type { ToolName } from "#core/session/handlers/tools.ts"
import { styleAccent, styleError, styleMuted, styleValue } from "#styles.ts"

const COMMAND_PROMPT = "$ "
// Match a shell's default continuation prompt, which marks a command's later lines the same way.
const CONTINUATION_PROMPT = "> "

/** Formats the `$ ` before a command in the accent color, so it only ever means that a command starts there. */
export const commandPromptElement = (): string => styleAccent(COMMAND_PROMPT)

/**
 * Formats the `> ` before a command's later lines in the prompt's color, so every line of a command is marked, and
 * nothing under it reads as part of it.
 */
export const continuationPromptElement = (): string => styleAccent(CONTINUATION_PROMPT)

/**
 * Formats the tool whose call ran a command in parentheses, like `(exec)`, muted the way a step's kind is, because it
 * says where a command came from the way a kind says what a step is.
 */
export const toolElement = (toolName: ToolName): string => styleMuted(`(${toolName})`)

/**
 * Formats a command a step ran as its lines, muted so the commands read as background next to the details. Shows a
 * command tsinfra wrote by its label in angle brackets, like `<file details script>`, because its text is tsinfra's
 * code, not the script's. Angle brackets mark text that isn't shown, as in the record's `<content as base64>`.
 */
export const commandLineElements = ({ cmd, label }: { cmd: string; label: string | undefined }): string[] => {
  const text = label === undefined ? cmd : `<${label}>`
  return text.split("\n").map((line) => styleMuted(line))
}

/** Formats a line of the command whose stderr explains a failure, in the value color, because it's the script's. */
export const failedCommandLineElement = (line: string): string => styleValue(line)

/** Formats a line a command printed to stdout, in the value color, because it came from the host. */
export const stdoutLineElement = (line: string): string => styleValue(line)

/** Formats a line a command printed to stderr in the error color. */
export const stderrLineElement = (line: string): string => styleError(line)
