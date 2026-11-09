import { sleep } from "bun"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { runProcess } from "#transport/run-process.ts"
import type { CommandOutput, Transport } from "#transport/transport.ts"
import { createCommandExitError } from "#utils.ts"

// See `docs/transport.md` for why each option is here.
const CONTROL_PATH_OPTION = "ControlPath=~/.ssh/tsinfra-%C"
const SSH_OPTIONS = [
  "-T",
  "-o",
  "ControlMaster=auto",
  "-o",
  CONTROL_PATH_OPTION,
  "-o",
  "ControlPersist=60",
  "-o",
  "BatchMode=yes",
]

const SSH_FAILURE_EXIT_CODE = 255
// ssh prints this when the connection closes at its idle limit just as a command joins it, before the command starts.
const CLOSING_CONNECTION_TEXT = "mux_client_hello_exchange"
const RETRY_DELAY_MS = 100

/** Runs `cmd` in `sh -s` on `target`, over ssh. */
const runOverSsh = async (target: string, cmd: string): Promise<Result<CommandOutput>> =>
  runProcess(["ssh", ...SSH_OPTIONS, "--", target, "sh", "-s"], cmd)

/**
 * Runs `cmd` over ssh again after a short wait, because the closing connection removes its socket as it exits, and a
 * retry before that would join it again.
 */
const retryOverSsh = async (target: string, cmd: string): Promise<Result<CommandOutput>> => {
  await sleep(RETRY_DELAY_MS)
  return runOverSsh(target, cmd)
}

/** Reports whether ssh failed because the connection closed as the command joined it, so the command never started. */
const hitClosingConnection = (commandOutput: CommandOutput) => {
  const { stderr, exitCode } = commandOutput
  return exitCode === SSH_FAILURE_EXIT_CODE && stderr.includes(CLOSING_CONNECTION_TEXT)
}

/**
 * Returns how to run commands on `target` over ssh. Runs a command again once when the connection closed as it joined,
 * because it never started. Fails on ssh's own exit code, so a lost connection never reads as a command that failed.
 */
export const createSshTransport =
  (target: string): Transport =>
  async (cmd) => {
    const firstOutput = await runOverSsh(target, cmd)
    if (isErr(firstOutput)) return firstOutput

    // retry once if we hit the closing connection
    const sshOutput = hitClosingConnection(firstOutput) ? await retryOverSsh(target, cmd) : firstOutput
    if (isErr(sshOutput)) return sshOutput

    if (sshOutput.exitCode === SSH_FAILURE_EXIT_CODE)
      return err("failed to run the command over ssh", createCommandExitError(sshOutput))

    return sshOutput
  }

/**
 * Stops the connection to `target` taking new commands, so it closes once the ones on it finish. Ignore a failure,
 * because the connection may already be gone.
 */
export const closeSshConnection = async (target: string) => {
  await runProcess(["ssh", "-o", CONTROL_PATH_OPTION, "-O", "stop", "--", target], "")
}
