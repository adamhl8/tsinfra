import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { CommandResult } from "#session/handlers/tools.ts"
import { inspectCommand } from "#session/handlers/tools.ts"
import type { StepContext, HandlerReturn } from "#session/step.ts"

/** Runs the `inspect` step, which runs the same command as the `inspect` tool and gives the script its result. */
export const handleInspect = async (ctx: StepContext, cmd: unknown): Promise<Result<HandlerReturn<CommandResult>>> => {
  const { shell } = ctx

  const commandResult = await inspectCommand({ toolName: "inspect", shell }, cmd)
  if (isErr(commandResult)) return commandResult

  return { outcome: { status: "observed", changed: false }, value: commandResult }
}
