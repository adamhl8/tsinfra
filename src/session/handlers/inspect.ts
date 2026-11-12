import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { EnvOptions, MaskOptions } from "#session/handlers/step-options/step-options.ts"
import type { InspectResult } from "#session/handlers/tools.ts"
import { inspectCommand } from "#session/handlers/tools.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

/** The options `h.inspect` takes. */
export interface InspectOptions extends EnvOptions, MaskOptions {}

/** Runs the `inspect` step, which runs the same command as the `inspect` tool and gives the script its result. */
export const handleInspect = async (
  ctx: StepContext<"inspect">,
  cmd: unknown,
): Promise<Result<HandlerReturn<InspectResult>>> => {
  const { shell } = ctx

  const inspectResult = await inspectCommand({ toolName: "inspect", shell }, cmd)
  if (isErr(inspectResult)) return inspectResult

  return { status: "observed", value: inspectResult }
}
