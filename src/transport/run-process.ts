import { spawn } from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { CommandOutput } from "#transport/transport.ts"

/** Runs `argv` with `input` on stdin, and returns what it printed and its exit code. */
export const runProcess = async (argv: string[], input: string, cwd?: string): Promise<Result<CommandOutput>> => {
  const [program = ""] = argv
  const subprocess = attempt(() =>
    spawn(argv, {
      ...(cwd !== undefined && { cwd }),
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
  if (isErr(subprocess)) return err(`failed to start '${program}'`, subprocess)

  const [stdout, stderr, exitCode] = await Promise.all([
    subprocess.stdout.text(),
    subprocess.stderr.text(),
    subprocess.exited,
  ])
  return { stdout, stderr, exitCode }
}
