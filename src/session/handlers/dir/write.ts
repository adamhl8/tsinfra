import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Shell } from "#transport/transport.ts"
import { quoteShellArg } from "#utils.ts"

/** Makes the directory at `path` on the host, and any parents it's missing, with the default mode and owner. */
export const writeDir = async (shell: Shell, path: string): Promise<Result> => {
  const writeScript = ["set -eu", `mkdir -p ${quoteShellArg(path)}`].join("\n")
  const writeScriptOutput = await shell.exec(writeScript, { label: "directory write script" })
  if (isErr(writeScriptOutput)) return err(`failed to make the directory at '${path}'`, writeScriptOutput)
}
