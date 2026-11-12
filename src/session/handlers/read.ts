import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { EnvOptions, MaskOptions } from "#session/handlers/step-options/step-options.ts"
import { execCommand } from "#session/handlers/tools.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

/** The options `h.read` takes. */
export interface ReadOptions extends EnvOptions, MaskOptions {}

/** Runs the `read` step, which runs the same command as the `read` tool and gives the script its stdout. */
export const handleRead = async (
  ctx: StepContext<"read">,
  cmd: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<string>>> => {
  const { shell } = ctx

  // Leave `options` to `execCommand`, which validates `maskOutput` for the tool too.
  const stdout = await execCommand({ toolName: "read", shell }, cmd, options)
  if (isErr(stdout)) return stdout

  return { status: "observed", value: stdout }
}
