import type { MessageKind } from "#core/session/handlers/log.ts"
import type { MessageRecord } from "#core/session/recorder/records.ts"
import type { MessageEntry } from "#report/host-block.ts"
import type { Verbosity } from "#report/verbosity.ts"

// Show a warning from level 0, like a step's warning, and an info from level 1, with the steps that were already right.
const MESSAGE_ENTRY_LEVELS: Record<MessageKind, Verbosity> = {
  info: 1,
  warn: 0,
}

/** Returns the entry of a message logged between steps. */
export const toMessageEntry = (messageRecord: MessageRecord): MessageEntry => {
  const { kind, messageKind, text } = messageRecord
  return { kind, messageKind, text, from: MESSAGE_ENTRY_LEVELS[messageKind] }
}
