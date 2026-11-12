import { INDENT } from "#report/format/layout.ts"
import type { StepCommand } from "#report/host-block/host-block.ts"
import { styleCommand, styleNote } from "#styles.ts"

const COMMAND_PROMPT = "$ "

/**
 * Formats a command as its lines, like `$ cat /etc/hostname`. Shows a command tsinfra wrote by its label in angle
 * brackets, like `$ <file details script>`, because its text is tsinfra's code, not the script's. Angle brackets mark
 * text that isn't shown, as in the record's `<content as base64>`. Lines up a command's later lines under its first
 * line's text.
 */
const formatCommandLines = ({ cmd, label }: StepCommand): string[] => {
  const text = label === undefined ? cmd : `<${label}>`
  const continuationIndent = " ".repeat(COMMAND_PROMPT.length)
  return text
    .split("\n")
    .map(
      (textLine, index) =>
        `${INDENT}${styleCommand(`${index === 0 ? COMMAND_PROMPT : continuationIndent}${textLine}`)}`,
    )
}

/** Formats a step's commands under a `commands:` heading, one command after another, in the order they ran. */
export const formatCommands = (commands: StepCommand[]): string[] => {
  const commandLines = commands.flatMap((command) => formatCommandLines(command))
  return [styleNote("commands:"), ...commandLines]
}
