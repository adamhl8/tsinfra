import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#session/shell.ts"

/** Runs one command and returns its stdout without trailing newlines. A non-zero exit throws. */
export type Read = (cmd: string) => Promise<string>

export const handleRead = async (shell: Shell, cmd: string): Promise<Result<string>> => {
  const stdout = await shell.run(cmd)
  if (isErr(stdout)) return err(`failed to read '${cmd}'`, stdout)

  return stdout
}
