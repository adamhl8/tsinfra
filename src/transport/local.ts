import os from "node:os"

import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

interface ShellOutput {
  stdout: string
  stderr: string
  exitCode: number
}

const LOCAL_SHELL = ["sh", "-s"]

// `sh -s` runs each line as soon as it reads it, and that line's command shares the script's stdin.
// In `cat\necho after`, `cat` reads `echo after` as its input, so `echo after` never runs.
// Wrap `script` in a group so the shell reads all of it before running any of it.
// Give the group /dev/null as stdin so its commands can't read the script either.
const wrapScript = (script: string) => `{ ${script}\n} </dev/null`

/** Runs `script` in `sh -s` on the control machine, from the home directory, like an SSH session would. */
export const runLocal = async (script: string): Promise<Result<ShellOutput>> => {
  const shell = attempt(() =>
    Bun.spawn(LOCAL_SHELL, {
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
