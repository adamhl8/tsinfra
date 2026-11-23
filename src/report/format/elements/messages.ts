import type { MessageKind } from "#core/session/handlers/log.ts"
import type { Style } from "#styles.ts"
import { styleMuted, stylePlain, styleWarning } from "#styles.ts"

// Color a warning like a step's warning, so it stands out, and dim an info, so it reads as background.
const MESSAGE_KIND_STYLES: Record<MessageKind, Style> = {
  info: styleMuted,
  warn: styleWarning,
}

/**
 * Formats a host message's label as `- ` and `word` in its kind's color, then an unstyled colon, like `- warning:`.
 * Uses one symbol for both kinds, because a symbol stands for one kind of line, and the word names the message's kind.
 */
export const hostMessageLabelElement = (messageKind: MessageKind, word: string): string =>
  `${MESSAGE_KIND_STYLES[messageKind](`- ${word}`)}:`

/** Formats a step message's label and its colon in its kind's color, like a step warning's `warning:`. */
export const stepMessageLabelElement = (messageKind: MessageKind, word: string): string =>
  MESSAGE_KIND_STYLES[messageKind](`${word}:`)

/** Formats a line of a message's text in the terminal's own color, because it's the script's own words. */
export const messageTextElement = (line: string): string => stylePlain(line)
