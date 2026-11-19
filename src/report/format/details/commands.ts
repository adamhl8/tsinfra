import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import { formatOptions } from "#report/format/details/options.ts"
import {
  commandPromptElement,
  commandLineElements,
  continuationPromptElement,
  toolElement,
} from "#report/format/elements/commands.ts"
import { headingElement } from "#report/format/elements/labels.ts"
import { INDENT } from "#report/format/layout.ts"
import type { CommandGroup, StepCommand } from "#report/host-block.ts"
import { getMaxWidth, padToWidth } from "#utils.ts"

// Start a command's options and output rows under its text, past the prompt.
const COMMAND_TEXT_INDENT = " ".repeat(getMaxWidth([commandPromptElement()]))

/**
 * Formats a command at `indent` as its lines, like `$ cat /etc/hostname`, after its tool when a tool call ran it, then
 * the call's options and what it printed, one level past its text. Starts a command's later lines with a continuation
 * prompt under its first prompt.
 */
const formatCommandLines = (command: StepCommand, indent: string, toolWidth: number): string[] => {
  const { toolName, options, output } = command
  // Pad every tool to `toolWidth`, so every prompt lines up, and leave the column out when no command has a tool.
  const toolColumn = toolWidth === 0 ? "" : `${padToWidth(toolName ? toolElement(toolName) : "", toolWidth)} `
  const promptIndent = `${indent}${" ".repeat(toolColumn === "" ? 0 : toolWidth + 1)}`
  const textIndent = `${promptIndent}${COMMAND_TEXT_INDENT}`

  const commandLines = commandLineElements(command).map((textLine, index) => {
    const lineStart =
      index === 0 ? `${indent}${toolColumn}${commandPromptElement()}` : `${promptIndent}${continuationPromptElement()}`
    return `${lineStart}${textLine}`
  })
  const detailIndent = `${textIndent}${INDENT}`
  const optionsLines = options === undefined ? [] : formatOptions(options).map((row) => `${detailIndent}${row}`)
  const outputLines = output === undefined ? [] : formatCommandOutputLines(output, detailIndent)
  return [...commandLines, ...optionsLines, ...outputLines]
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
