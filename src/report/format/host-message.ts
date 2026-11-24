import type { MessageKind } from "#core/session/handlers/log.ts"
import type { FormattedHostMessageEntry } from "#report/format.ts"
import { hostMessageLabelElement, messageTextElement } from "#report/format/elements/messages.ts"
import type { HostMessageEntry } from "#report/host-block.ts"
import { splitLines } from "#utils.ts"

/** The word each kind of message is labeled with, a host message or a step message. */
export const MESSAGE_KIND_WORDS: Record<MessageKind, string> = {
  info: "info",
  warn: "warning",
}

/**
 * Formats a host message entry as an aligned row of its kind's label and its text, so the text's later lines go under
 * its first.
 */
export const formatHostMessageEntry = (hostMessageEntry: HostMessageEntry): FormattedHostMessageEntry => {
  const { messageKind, text } = hostMessageEntry
  const label = `${hostMessageLabelElement(messageKind, MESSAGE_KIND_WORDS[messageKind])} `
  const valueLines = splitLines(text).map((line) => messageTextElement(line))
  return { kind: "hostMessage", row: { kind: "value", label, valueLines } }
}
