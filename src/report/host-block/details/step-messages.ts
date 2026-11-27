import { firstBy } from "remeda"

import type { MessageKind } from "#core/session/handlers/log.ts"
import type { StepMessageRecord } from "#core/session/recorder/records/message.ts"
import type { StepRecord } from "#core/session/recorder/records/step.ts"
import type { Detail, StepMessage } from "#report/host-block.ts"
import { COMMANDS_LEVEL } from "#report/host-block/details/commands.ts"
import type { Verbosity } from "#report/verbosity.ts"

/**
 * The level each kind of message shows from, a host message or a step message: a warning from 0, like a step's warning,
 * and an info from 1, with the steps that were already right.
 */
export const MESSAGE_LEVELS: Record<MessageKind, Verbosity> = {
  info: 1,
  warn: 0,
}

/** Returns a step message with its kind's level, and its place among the step's commands from the commands' level. */
const toStepMessage = (stepMessageRecord: StepMessageRecord): StepMessage => {
  const { messageKind, text, phase, commandCount } = stepMessageRecord
  return {
    messageKind,
    text,
    phase,
    commandCount,
    amongCommands: { from: COMMANDS_LEVEL },
    from: MESSAGE_LEVELS[messageKind],
  }
}

/**
 * Returns a step's messages as one detail, every one it logged, or none when it logged none. The detail shows from the
 * lowest level any of its messages shows from.
 */
export const toStepMessagesDetails = (stepRecord: StepRecord): Detail[] => {
  const stepMessages = stepRecord.messages.map((stepMessageRecord) => toStepMessage(stepMessageRecord))
  const lowestLevelMessage = firstBy(stepMessages, ({ from }) => from)
  if (lowestLevelMessage === undefined) return []

  return [{ kind: "stepMessages", stepMessages, from: lowestLevelMessage.from }]
}
