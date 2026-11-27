import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { MessageRecorder } from "#core/recorder/session-recorder.ts"
import type { Log, MessageKind } from "#core/session/handlers/log.ts"
import { validateMessage } from "#core/session/handlers/log.ts"
import type { ScriptBoundary } from "#core/session/script-boundary.ts"

/** Returns `h.log`, whose methods record the script's messages through `scriptBoundary`. */
export const createLog = (messageRecorder: MessageRecorder, scriptBoundary: ScriptBoundary): Log => {
  const { recordMessage } = messageRecorder
  const { callOrFailSync } = scriptBoundary

  // Keep `h.log` synchronous, because it runs nothing, and a script shouldn't have to await a message.
  const createLogMethod = (messageKind: MessageKind) => (message: unknown) => {
    callOrFailSync((): Result => {
      const validMessage = validateMessage(messageKind, message)
      if (isErr(validMessage)) return validMessage

      recordMessage(messageKind, validMessage)
    })
  }

  return { info: createLogMethod("info"), warn: createLogMethod("warn") }
}
