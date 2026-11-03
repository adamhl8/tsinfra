import type { Result } from "ts-explicit-errors"

import { execCommand } from "#session/handlers/tools.ts"
import type { StepContext } from "#session/step.ts"

/** Runs the `read` step, which runs the same command as the `read` tool. */
export const handleRead = async (ctx: StepContext, cmd: unknown): Promise<Result<string>> => {
  const { shell } = ctx

  const stdout = await execCommand({ toolName: "read", shell }, cmd)
  return stdout
}
