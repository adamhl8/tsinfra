import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { MaskOptions } from "#core/session/handlers/options/handler.ts"
import type { EnvOptions } from "#core/session/handlers/options/shell.ts"
import type { InspectResult } from "#core/session/handlers/tools.ts"
import { inspectCommand } from "#core/session/handlers/tools.ts"
import type { HandlerReturn, StepContext } from "#core/session/step.ts"

/** The options `h.inspect` takes. */
export interface InspectOptions extends EnvOptions, MaskOptions {}

/** Runs the `inspect` step, which runs the same command as the `inspect` tool and gives the script its result. */
export const handleInspect = async (
  ctx: StepContext<"inspect">,
  cmd: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<InspectResult>>> => {
  const { shell } = ctx

  // Leave `options` to `inspectCommand`, which validates `maskOutput` for the tool too.
  const inspectResult = await inspectCommand({ toolName: "inspect", shell }, cmd, options)
  if (isErr(inspectResult)) return inspectResult

  return { status: "observed", value: inspectResult }
}
