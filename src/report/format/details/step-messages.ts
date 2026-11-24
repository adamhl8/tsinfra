import type { AlignedRow } from "#report/format/details/shared/aligned-row.ts"
import { messageTextElement, stepMessageLabelElement } from "#report/format/elements/messages.ts"
import { MESSAGE_KIND_WORDS } from "#report/format/host-message.ts"
import { layoutRowsInOwnColumn } from "#report/format/layout.ts"
import type { StepMessage } from "#report/host-block.ts"
import { splitLines } from "#utils.ts"

const isSameMessage = (a: StepMessage, b: StepMessage): boolean => a.messageKind === b.messageKind && a.text === b.text

/** Formats a step message as a row of its kind's label and its text. */
const formatStepMessageRow = (stepMessage: StepMessage): AlignedRow => {
  const { messageKind, text } = stepMessage
  const label = `${stepMessageLabelElement(messageKind, MESSAGE_KIND_WORDS[messageKind])} `
  const valueLines = splitLines(text).map((line) => messageTextElement(line))
  return { kind: "value", label, valueLines }
}

/**
 * Formats a step message as its lines, in a column of its own, so its text's later lines go under its first and a long
 * label doesn't push the entry's other values right.
 */
export const formatStepMessageLines = (stepMessage: StepMessage): string[] =>
  layoutRowsInOwnColumn([formatStepMessageRow(stepMessage)])

/**
 * Formats the step messages that show as rows under the step, each distinct one once, in the order it was first logged.
 * A check that logs the same thing before and after the fix shows it once.
 */
export const formatStepMessageRows = (stepMessages: StepMessage[]): string[] => {
  const rowMessages = stepMessages.filter(({ amongCommands }) => amongCommands === undefined)
  const distinctMessages = rowMessages.filter(
    (stepMessage, index) => rowMessages.findIndex((other) => isSameMessage(stepMessage, other)) === index,
  )
  return distinctMessages.flatMap((stepMessage) => formatStepMessageLines(stepMessage))
}
