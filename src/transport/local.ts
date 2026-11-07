import os from "node:os"

import { spawn } from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { CommandOutput } from "#transport/transport.ts"
import { wrapScript } from "#transport/wrap-script.ts"

const LOCAL_SHELL = ["sh", "-s"]

/** Runs `script` in `sh -s` on the control machine, from the home directory, like an SSH session would. */
export const runLocal = async (script: string): Promise<Result<CommandOutput>> => {
  const shell = attempt(() =>
    spawn(LOCAL_SHELL, {
      cwd: os.homedir(),
      stdin: new Blob([wrapScript(script)]),
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
  if (isErr(shell)) return err("failed to start the local shell", shell)

  const [stdout, stderr, exitCode] = await Promise.all([shell.stdout.text(), shell.stderr.text(), shell.exited])
  return { stdout, stderr, exitCode }
}
