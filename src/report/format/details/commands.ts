import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import { commandPromptElement, commandLineElements } from "#report/format/elements/commands.ts"
import { headingElement } from "#report/format/elements/labels.ts"
import { INDENT } from "#report/format/layout.ts"
import type { CommandGroup, StepCommand } from "#report/host-block.ts"
import { getMaxWidth } from "#utils.ts"

// Start a command's later lines and its output rows under its text, past the prompt.
const COMMAND_TEXT_INDENT = " ".repeat(getMaxWidth([commandPromptElement()]))

/**
 * Formats a command at `indent` as its lines, like `$ cat /etc/hostname`, then what it printed one level past its text.
 * Lines up a command's later lines under its first line's text.
 */
const formatCommandLines = (command: StepCommand, indent: string): string[] => {
  const { output } = command
  const textIndent = `${indent}${COMMAND_TEXT_INDENT}`

  const commandLines = commandLineElements(command).map((textLine, index) => {
    const lineStart = index === 0 ? `${indent}${commandPromptElement()}` : textIndent
    return `${lineStart}${textLine}`
  })
  const outputLines = output === undefined ? [] : formatCommandOutputLines(output, `${textIndent}${INDENT}`)
  return [...commandLines, ...outputLines]
}

/** Formats a group's commands, under a heading for its phase when that shows, with the commands one level past it. */
const formatCommandGroup = (group: CommandGroup): string[] => {
  const { phase, commands } = group
  const commandIndent = phase === undefined ? INDENT : INDENT.repeat(2)
  const commandLines = commands.flatMap((command) => formatCommandLines(command, commandIndent))
  return phase === undefined ? commandLines : [`${INDENT}${headingElement(phase.phase)}`, ...commandLines]
}

/** Formats a step's commands under a `commands:` heading, one group after another, in the order they ran. */
export const formatCommands = (groups: CommandGroup[]): string[] => {
  const commandLines = groups.flatMap((group) => formatCommandGroup(group))
  return [headingElement("commands"), ...commandLines]
}
