import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import { commandPromptElement, commandLineElements, toolElement } from "#report/format/elements/commands.ts"
import { headingElement } from "#report/format/elements/labels.ts"
import { INDENT } from "#report/format/layout.ts"
import type { CommandGroup, StepCommand } from "#report/host-block.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

// Start a command's later lines and its output rows under its text, past the prompt.
const COMMAND_TEXT_INDENT = " ".repeat(getMaxWidth([commandPromptElement()]))

/**
 * Formats a command at `indent` as its lines, like `$ cat /etc/hostname`, after its tool when a tool call ran it, then
 * what it printed one level past its text. Lines up a command's later lines under its first line's text.
 */
const formatCommandLines = (command: StepCommand, indent: string, toolWidth: number): string[] => {
  const { toolName, output } = command
  // Pad every tool to `toolWidth`, so every prompt lines up, and leave the column out when no command has a tool.
  const toolColumn = toolWidth === 0 ? "" : `${padToWidth(toolName ? toolElement(toolName) : "", toolWidth)} `
  const textIndent = `${indent}${" ".repeat(toolColumn === "" ? 0 : toolWidth + 1)}${COMMAND_TEXT_INDENT}`

  const commandLines = commandLineElements(command).map((textLine, index) => {
    const lineStart = index === 0 ? `${indent}${toolColumn}${commandPromptElement()}` : textIndent
    return `${lineStart}${textLine}`
  })
  const outputLines = output === undefined ? [] : formatCommandOutputLines(output, `${textIndent}${INDENT}`)
  return [...commandLines, ...outputLines]
}

/** Formats a group's commands, under a heading for its phase when that shows, with the commands one level past it. */
const formatCommandGroup = (group: CommandGroup, toolWidth: number): string[] => {
  const { phase, commands } = group
  const commandIndent = phase === undefined ? INDENT : INDENT.repeat(2)
  const commandLines = commands.flatMap((command) => formatCommandLines(command, commandIndent, toolWidth))
  return phase === undefined ? commandLines : [`${INDENT}${headingElement(phase.phase)}`, ...commandLines]
}

/**
 * Formats a step's commands under a `commands:` heading, one group after another, in the order they ran. Pads the tools
 * across every group, so the prompts line up across the phases.
 */
export const formatCommands = (groups: CommandGroup[]): string[] => {
  const commands = groups.flatMap((group) => group.commands)
  const tools = commands.flatMap(({ toolName }) => (toolName === undefined ? [] : [toolElement(toolName)]))
  const toolWidth = getMaxWidth(tools)
  const commandLines = groups.flatMap((group) => formatCommandGroup(group, toolWidth))
  return [headingElement("commands"), ...commandLines]
}
