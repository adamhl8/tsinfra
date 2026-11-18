import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { InputOptions, MaskOptions } from "#core/session/handlers/options/handler.ts"
import type { EnvOptions } from "#core/session/handlers/options/shell.ts"
import type { InspectResult } from "#core/session/handlers/tools.ts"
import { runInspectCommand, validateToolCall } from "#core/session/handlers/tools.ts"
import type { HandlerReturn, StepContext } from "#core/session/step.ts"

/** The options `h.inspect` takes. */
export interface InspectOptions extends EnvOptions, InputOptions, MaskOptions {}

/** Runs the `inspect` step, which runs the same command as the `inspect` tool and gives the script its result. */
export const handleInspect = async (
  ctx: StepContext<"inspect">,
  cmd: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<InspectResult>>> => {
  const { shell, recordOptions } = ctx

  const toolCall = validateToolCall("inspect", cmd, options)
  if (isErr(toolCall)) return toolCall
  // Record `input` before running, because reading it can fail.
  recordOptions({ input: toolCall.options.input })

  const inspectResult = await runInspectCommand({ toolName: "inspect", shell }, toolCall)
  if (isErr(inspectResult)) return inspectResult

  return { status: "observed", value: inspectResult }
}
