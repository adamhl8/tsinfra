import type { MessageKind } from "#core/session/handlers/log.ts"
import type { FormattedMessageEntry } from "#report/format.ts"
import { messageEntryLabelElement, messageTextElement } from "#report/format/elements/entry.ts"
import type { MessageEntry } from "#report/host-block.ts"
import { splitLines } from "#utils.ts"

const MESSAGE_KIND_WORDS: Record<MessageKind, string> = {
  info: "info",
  warn: "warning",
}

/**
 * Formats a message entry as an aligned row of its kind's label and its text, so the text's later lines go under its
 * first.
 */
export const formatMessageEntry = (messageEntry: MessageEntry): FormattedMessageEntry => {
  const { messageKind, text } = messageEntry
  const label = `${messageEntryLabelElement(messageKind, MESSAGE_KIND_WORDS[messageKind])} `
  const valueLines = splitLines(text).map((line) => messageTextElement(line))
  return { kind: "message", row: { label, valueLines } }
}
