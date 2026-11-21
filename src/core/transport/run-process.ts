import { spawn } from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, err, isErr } from "ts-explicit-errors"

import type { CommandOutput } from "#core/transport.ts"
import { trackRunningProcess } from "#core/transport/running-processes.ts"

/**
 * Runs `argv` with `input` on stdin, and returns what it printed and its exit code. Starts it in a session of its own,
 * with no terminal, so nothing it runs can prompt on the terminal tsinfra runs in.
 */
export const runProcess = async (argv: string[], input: string, cwd?: string): Promise<Result<CommandOutput>> => {
  const [program = ""] = argv
  const subprocess = attempt(() =>
    spawn(argv, {
      ...(cwd !== undefined && { cwd }),
      detached: true,
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    }),
  )
  if (isErr(subprocess)) return err(`failed to start '${program}'`, subprocess)

  const stopTracking = trackRunningProcess(subprocess.pid)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      subprocess.stdout.text(),
      subprocess.stderr.text(),
      subprocess.exited,
    ])
    return { stdout, stderr, exitCode }
  } finally {
    stopTracking()
  }
}
