import { attempt, err, isErr } from "ts-explicit-errors"

import type { Host, Mode, StepOptions, StepResult } from "#hosts/host.ts"
import type { HostEntry } from "#hosts/load.ts"
import type { ShellOutput } from "#transport/local.ts"
import { getTransport } from "#transport/transport.ts"

const TRAILING_NEWLINES = /\n+$/v

interface HostSession {
  host: Host
  getFailure: () => Error | undefined
}

type CheckOutcome = { checkPassed: true } | { checkPassed: false; stderr: string }

const createCommandExitError = ({ exitCode, stderr }: ShellOutput) => {
  const trimmedStderr = stderr.trim()
  return err(`exited with code ${exitCode}${trimmedStderr && `: ${trimmedStderr}`}`, undefined)
}

/** Builds the `Host` passed to a host's function, and tracks the run's failure where the script can't see it. */
export const createHostSession = ({ name, target }: HostEntry, mode: Mode): HostSession => {
  const exec = getTransport(target)
  let failure: Error | undefined

  // Keep only the first failure, because calls made at once with `Promise.all` can each fail.
  // Throw it on every later call, so a script that catches it still can't use the host.
  // Type `fail` itself, not just its return, so TypeScript knows nothing runs after a call to it.
  const fail: (error: Error) => never = (error) => {
    failure ??= error
    throw failure
  }

  // Runs `cmd`, failing the host with `errorMessage` when it can't run or exits non-zero.
  const runOrFail = async (cmd: string, errorMessage: string) => {
    const output = await exec(cmd)
    if (isErr(output)) fail(err(errorMessage, output))
    if (output.exitCode !== 0) fail(err(errorMessage, createCommandExitError(output)))
    return output.stdout
  }

  const runCheck = async (stepName: string, check: StepOptions["check"]): Promise<CheckOutcome> => {
    const errorMessage = `failed to check step '${stepName}'`

    if (typeof check === "function") {
      const checkPassed = await attempt(async () => check())
      if (isErr(checkPassed)) {
        // Wrap the recorded failure when the check threw it, so the report names the step.
        const error = err(errorMessage, checkPassed)
        if (failure === checkPassed) failure = error
        fail(error)
      }

      return checkPassed ? { checkPassed: true } : { checkPassed: false, stderr: "" }
    }

    const output = await exec(check)
    if (isErr(output)) fail(err(errorMessage, output))
    return output.exitCode === 0 ? { checkPassed: true } : { checkPassed: false, stderr: output.stderr.trim() }
  }

  const read = async (cmd: string) => {
    if (failure) throw failure

    const stdout = await runOrFail(cmd, `failed to read '${cmd}'`)
    return stdout.replace(TRAILING_NEWLINES, "")
  }

  const step = async (stepName: string, { check, fix }: StepOptions): Promise<StepResult> => {
    if (failure) throw failure

    const before = await runCheck(stepName, check)
    if (before.checkPassed) return { changed: false }
    if (mode === "plan") return { changed: true }

    await runOrFail(fix, `failed to run the fix for step '${stepName}'`)

    const after = await runCheck(stepName, check)
    if (!after.checkPassed) {
      const message = `the check for step '${stepName}' still fails after the fix${after.stderr && `: ${after.stderr}`}`
      fail(err(message, undefined))
    }

    return { changed: true }
  }

  return { host: { name, read, step }, getFailure: () => failure }
}
