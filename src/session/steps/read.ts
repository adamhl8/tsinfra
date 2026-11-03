import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#session/shell.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

/** Runs one command and returns its stdout, trimmed. A non-zero exit throws. */
export type Read = (cmd: string) => Promise<string>

export const handleRead = async (shell: Shell, cmd: string): Promise<Result<string>> => {
  const validCmd = nonEmptyStringSchema(cmd)
  if (validCmd instanceof type.errors)
    return err("failed to validate the command given to 'read'", err(validCmd.summary, undefined))

  const stdout = await shell.run(cmd)
  if (isErr(stdout)) return err(`failed to read '${cmd}'`, stdout)

  return stdout.trim()
}
