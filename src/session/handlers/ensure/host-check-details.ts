import type { Result } from "ts-explicit-errors"
import { attempt, isErr } from "ts-explicit-errors"

import type { Check } from "#session/handlers/ensure/check.ts"
import type { ReadTools } from "#session/handlers/tools.ts"
import type { Shell, CommandOutput } from "#transport/transport.ts"

/** What the check found on the host: what a check function returned, or a check command's output. */
export type HostCheckDetails = { kind: "function"; value: unknown } | { kind: "command"; commandOutput: CommandOutput }

/**
 * Runs `check` as a command, or calls the script's function with its tools, and returns what it found. Use `inspect`,
 * because a check's non-zero exit is an answer.
 */
export const getHostCheckDetails = async (
  shell: Shell,
  readTools: ReadTools,
  check: Check<unknown>,
): Promise<Result<HostCheckDetails>> => {
  if (typeof check === "function") {
    // Wrap the value, because `attempt` would treat a returned `Error` as a thrown one.
    const returned = await attempt(async () => ({ value: await check(readTools) }))
    return isErr(returned) ? returned : { kind: "function", value: returned.value }
  }

  const commandOutput = await shell.inspect(check)
  return isErr(commandOutput) ? commandOutput : { kind: "command", commandOutput }
}
