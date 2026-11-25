import type { ConvergePhase } from "#core/session/recorder/records.ts"
import { formatCommandOutputLines } from "#report/format/details/command-output.ts"
import { formatOptions } from "#report/format/details/options.ts"
import { formatStepMessageLines } from "#report/format/details/step-messages.ts"
import {
  commandPromptElement,
  commandLineElements,
  continuationPromptElement,
  toolElement,
} from "#report/format/elements/commands.ts"
import { headingElement } from "#report/format/elements/labels.ts"
import { INDENT } from "#report/format/layout.ts"
import type { StepCommand, StepMessage } from "#report/host-block.ts"
import { getMaxWidth, padToWidth } from "#report/utils.ts"

// Start a command's options and output rows under its text, past the prompt.
const COMMAND_TEXT_INDENT = " ".repeat(getMaxWidth([commandPromptElement()]))

/**
 * Formats a command as its lines, like `$ cat /etc/hostname`, after its tool when a tool call ran it, then the call's
 * options and what it printed, one level past its text. Starts a command's later lines with a continuation prompt under
 * its first prompt.
 */
const formatCommandLines = (command: StepCommand, toolWidth: number): string[] => {
  const { toolName, options, output } = command
  // Pad every tool to `toolWidth`, so every prompt lines up, and leave the column out when no command has a tool.
  const toolColumn = toolWidth === 0 ? "" : `${padToWidth(toolName ? toolElement(toolName) : "", toolWidth)} `
  const promptIndent = " ".repeat(toolColumn === "" ? 0 : toolWidth + 1)
  const textIndent = `${promptIndent}${COMMAND_TEXT_INDENT}`

  const commandLines = commandLineElements(command).map((textLine, index) => {
    const lineStart =
      index === 0 ? `${toolColumn}${commandPromptElement()}` : `${promptIndent}${continuationPromptElement()}`
    return `${lineStart}${textLine}`
  })
  const detailIndent = `${textIndent}${INDENT}`
  const optionsLines = options.length > 0 ? formatOptions(options).map((row) => `${detailIndent}${row}`) : []
  const outputLines = output === undefined ? [] : formatCommandOutputLines(output, detailIndent)
  return [...commandLines, ...optionsLines, ...outputLines]
}

/** A command's or a step message's lines, with the phase that recorded it, before they go under their headings. */
interface PlacedLines {
  phase: ConvergePhase | undefined
  lines: string[]
}

/**
 * Formats each command's lines and each step message's lines, and places each message after the commands its
 * `commandCount` counts.
 */
const formatPlacedLines = (commands: StepCommand[], stepMessages: StepMessage[], toolWidth: number): PlacedLines[] => {
  const getMessageLinesAtCommandCount = (commandCount: number): PlacedLines[] =>
    stepMessages
      .filter((stepMessage) => stepMessage.commandCount === commandCount)
      .map((stepMessage) => ({ phase: stepMessage.phase, lines: formatStepMessageLines(stepMessage) }))

  const commandLines = commands.flatMap((command, index) => [
    { phase: command.phase, lines: formatCommandLines(command, toolWidth) },
    ...getMessageLinesAtCommandCount(index + 1),
  ])

  return [...getMessageLinesAtCommandCount(0), ...commandLines]
}

/**
 * Indents placed lines under the commands heading. With phase headings, puts a heading wherever the phase changes, and
 * the lines in a phase one level past it.
 */
const formatPhaseGroups = (placedLines: PlacedLines[], hasPhaseHeadings: boolean): string[] =>
  placedLines.flatMap(({ phase, lines }, index) => {
    if (!hasPhaseHeadings || phase === undefined) return lines.map((line) => `${INDENT}${line}`)

    const isNewPhase = placedLines[index - 1]?.phase !== phase
    const headingLines = isNewPhase ? [`${INDENT}${headingElement(phase)}`] : []
    return [...headingLines, ...lines.map((line) => `${INDENT.repeat(2)}${line}`)]
  })

/**
 * Formats a step's commands under a `commands:` heading, in the order they ran, with `stepMessages` placed among them.
 * Pads the tools across every command, so the prompts line up across the phases.
 */
export const formatCommands = (
  commands: StepCommand[],
  hasPhaseHeadings: boolean,
  stepMessages: StepMessage[],
): string[] => {
  const tools = commands.flatMap(({ toolName }) => (toolName === undefined ? [] : [toolElement(toolName)]))
  const toolWidth = getMaxWidth(tools)
  const placedLines = formatPlacedLines(commands, stepMessages, toolWidth)
  const phaseGroupLines = formatPhaseGroups(placedLines, hasPhaseHeadings)
  return [headingElement("commands"), ...phaseGroupLines]
}
