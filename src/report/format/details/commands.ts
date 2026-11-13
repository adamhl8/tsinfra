import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import { INDENT } from "#report/format/layout.ts"
import type { StepCommand } from "#report/host-block/host-block.ts"
import type { ConvergePhase } from "#session/session.ts"
import { styleCommand, styleCommandPrompt, styleLabel, styleNote } from "#styles.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

const COMMAND_PROMPT = "$ "
// Start a command's later lines and its output rows under its text, past the prompt.
const COMMAND_TEXT_INDENT = " ".repeat(COMMAND_PROMPT.length)

/**
 * Formats the part of a step that ran a command in parentheses, like `(before)`, the way a step's kind shows, because
 * it sorts the step's commands the way a kind sorts steps.
 */
const formatPhase = (phase: ConvergePhase): string => `(${phase})`

/**
 * Formats a command as its lines, like `$ cat /etc/hostname`, after its phase when that shows, then what it printed one
 * level past its text. Shows a command tsinfra wrote by its label in angle brackets, like `$ <file details script>`,
 * because its text is tsinfra's code, not the script's. Angle brackets mark text that isn't shown, as in the record's
 * `<content as base64>`. Lines up a command's later lines under its first line's text.
 */
const formatCommandLines = (command: StepCommand, phaseWidth: number): string[] => {
  const { cmd, label, phase, output } = command
  const text = label === undefined ? cmd : `<${label}>`
  // Pad every phase to `phaseWidth`, so every prompt lines up, and leave the column out when no command has a phase.
  const phaseColumn =
    phaseWidth === 0 ? "" : `${padToWidth(phase ? styleLabel(formatPhase(phase.phase)) : "", phaseWidth)} `
  const textIndent = `${INDENT}${" ".repeat(phaseColumn === "" ? 0 : phaseWidth + 1)}${COMMAND_TEXT_INDENT}`

  const commandLines = text.split("\n").map((textLine, index) => {
    const lineStart = index === 0 ? `${INDENT}${phaseColumn}${styleCommandPrompt(COMMAND_PROMPT)}` : textIndent
    return `${lineStart}${styleCommand(textLine)}`
  })
  const outputLines = output === undefined ? [] : formatCommandOutputLines(output, `${textIndent}${INDENT}`)
  return [...commandLines, ...outputLines]
}

/** Formats a step's commands under a `commands:` heading, one command after another, in the order they ran. */
export const formatCommands = (commands: StepCommand[]): string[] => {
  const phases = commands.flatMap(({ phase }) => (phase === undefined ? [] : [formatPhase(phase.phase)]))
  const phaseWidth = getMaxWidth(phases)
  const commandLines = commands.flatMap((command) => formatCommandLines(command, phaseWidth))
  return [styleNote("commands:"), ...commandLines]
}
