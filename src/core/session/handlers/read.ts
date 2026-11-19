import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { EnvOptions, InputOptions, MaskOptions } from "#core/session/handlers/options/command.ts"
import { runExecCommand, validateToolCall } from "#core/session/handlers/tools.ts"
import type { HandlerReturn, StepContext } from "#core/session/step.ts"

/** The options `h.read` takes. */
export interface ReadOptions extends EnvOptions, InputOptions, MaskOptions {}

/** Runs the `read` step, which runs the same command as the `read` tool and gives the script its stdout. */
export const handleRead = async (
  ctx: StepContext<"read">,
  cmd: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<string>>> => {
  const { shell, recordOptions } = ctx

  const toolCall = validateToolCall("read", cmd, options)
  if (isErr(toolCall)) return toolCall
  // Record the options before running, because reading `input` can fail.
  const { input, maskOutput } = toolCall.options
  recordOptions({ input, maskOutput })

  const stdout = await runExecCommand({ toolName: "read", shell }, toolCall)
  if (isErr(stdout)) return stdout

  return { status: "observed", value: stdout }
}
