import type { Result } from "ts-explicit-errors"

import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import { nonEmptyStringSchema } from "#core/session/step.ts"

/**
 * Records messages for the report, which shows each one in place: under the step whose function logged it, or between
 * the steps around it. It runs nothing on the host.
 */
export interface Log {
  /** Records `message`, which the report shows from `-v`. */
  info: (message: string) => void
  /** Records `message` as a warning, which the report shows at the default level, and counts in the summary. */
  warn: (message: string) => void
}

export type MessageKind = keyof Log

/** Validates the message the script gave `h.log`'s method for `messageKind`. */
export const validateMessage = (messageKind: MessageKind, message: unknown): Result<string> =>
  validateInput(message, nonEmptyStringSchema, { inputLabel: "message", givenTo: `log.${messageKind}` })
