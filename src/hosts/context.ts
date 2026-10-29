import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { Host } from "#hosts/host.ts"
import type { LoadedHost } from "#hosts/load.ts"
import { runLocal } from "#transport/local.ts"

const LOCAL_TARGET = "@local"
const TRAILING_NEWLINES = /\n+$/v

interface HostContext {
  h: Host
  getFailure: () => Error | undefined
}

/** Runs `cmd` on `target` and returns its stdout, or an error when it exits non-zero. */
const runCommand = async (target: string, cmd: string): Promise<Result<string>> => {
  if (target !== LOCAL_TARGET) return err(`target '${target}' isn't supported yet (only '${LOCAL_TARGET}')`, undefined)

  const output = await runLocal(cmd)
  if (isErr(output)) return output

  const stderr = output.stderr.trim()
  if (output.exitCode !== 0) return err(`exited with code ${output.exitCode}${stderr && `: ${stderr}`}`, undefined)

  return output.stdout
}

/** Builds the `h` passed to a host function, keeping the host's failure out of its public API. */
export const createHostContext = ({ name, target }: LoadedHost): HostContext => {
  let failure: Error | undefined

  // Throw the first failure again on every later call, so a script that catches it still can't use the host.
  // Keep only the first failure, because calls made at once with `Promise.all` can each fail.
  const read = async (cmd: string) => {
    if (failure) throw failure

    const stdout = await runCommand(target, cmd)
    if (isErr(stdout)) {
      failure ??= err(`failed to read '${cmd}'`, stdout)
      throw failure
    }

    return stdout.replace(TRAILING_NEWLINES, "")
  }

  return { h: { name, read }, getFailure: () => failure }
}
