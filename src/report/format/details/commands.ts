import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import {
  commandPromptElement,
  commandLineElements,
  headingElement,
  phaseElement,
} from "#report/format/elements/elements.ts"
import { INDENT } from "#report/format/layout.ts"
import type { StepCommand } from "#report/host-block/host-block.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

// Start a command's later lines and its output rows under its text, past the prompt.
const COMMAND_TEXT_INDENT = " ".repeat(getMaxWidth([commandPromptElement()]))

/**
 * Formats a command as its lines, like `$ cat /etc/hostname`, after its phase when that shows, then what it printed one
 * level past its text. Lines up a command's later lines under its first line's text.
 */
const formatCommandLines = (command: StepCommand, phaseWidth: number): string[] => {
  const { phase, output } = command
  // Pad every phase to `phaseWidth`, so every prompt lines up, and leave the column out when no command has a phase.
  const phaseColumn = phaseWidth === 0 ? "" : `${padToWidth(phase ? phaseElement(phase.phase) : "", phaseWidth)} `
  const textIndent = `${INDENT}${" ".repeat(phaseColumn === "" ? 0 : phaseWidth + 1)}${COMMAND_TEXT_INDENT}`

  const commandLines = commandLineElements(command).map((textLine, index) => {
    const lineStart = index === 0 ? `${INDENT}${phaseColumn}${commandPromptElement()}` : textIndent
    return `${lineStart}${textLine}`
  })
  const outputLines = output === undefined ? [] : formatCommandOutputLines(output, `${textIndent}${INDENT}`)
  return [...commandLines, ...outputLines]
}

/** Formats a step's commands under a `commands:` heading, one command after another, in the order they ran. */
export const formatCommands = (commands: StepCommand[]): string[] => {
  const phases = commands.flatMap(({ phase }) => (phase === undefined ? [] : [phaseElement(phase.phase)]))
  const phaseWidth = getMaxWidth(phases)
  const commandLines = commands.flatMap((command) => formatCommandLines(command, phaseWidth))
  return [headingElement("commands"), ...commandLines]
}
