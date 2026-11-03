import type { Result } from "ts-explicit-errors"

import type { CommandResult } from "#session/handlers/tools.ts"
import { inspectCommand } from "#session/handlers/tools.ts"
import type { StepContext } from "#session/step.ts"

/** Runs the `inspect` step, which runs the same command as the `inspect` tool. */
export const handleInspect = async (ctx: StepContext, cmd: unknown): Promise<Result<CommandResult>> => {
  const { shell } = ctx

  const commandResult = await inspectCommand({ toolName: "inspect", shell }, cmd)
  return commandResult
}
