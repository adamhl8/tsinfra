import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#session/shell.ts"

export const readOutput = async (shell: Shell, cmd: string): Promise<Result<string>> => {
  const stdout = await shell.run(cmd)
  if (isErr(stdout)) return err(`failed to read '${cmd}'`, stdout)

  return stdout
}
