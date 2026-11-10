import { isErr, messageChain } from "ts-explicit-errors"

import type { ValidHostOptions } from "#hosts/hosts.ts"
import type { CommandRecord } from "#session/recorder/records.ts"

/** Reports whether a command exited non-zero with `stderrText` in its stderr. */
const hasFailedWithStderr = (commandRecords: CommandRecord[], stderrText: string) => {
  const outputs = commandRecords.map(({ output }) => output)
  return outputs.some(
    (output) => output !== undefined && !isErr(output) && output.exitCode !== 0 && output.stderr.includes(stderrText),
  )
}

// Name both fixes, because `sudo: true` and `sudo: { password }` each give sudo what it needs.
const SUDO_OPTION_HINT = "sudo needs a password on this host, so set the sudo option on host()"

/** Returns the hints for a step that failed, from its own commands, each guarded by the failure it fixes. */
export const getStepFailureHints = (hostOptions: ValidHostOptions, commandRecords: CommandRecord[]): string[] => {
  // Hint at the `sudo` option only on a host that leaves it off, because a host that sets it already did the fix.
  // Match the line `sudo -n` prints when it needs a password. It's English only, so another locale gets no hint.
  if (hostOptions.sudo === false && hasFailedWithStderr(commandRecords, "sudo: a password is required"))
    return [SUDO_OPTION_HINT]

  return []
}

// Point at the line ssh names as offending, because at `LogLevel=ERROR` it prints that, but not its `ssh-keygen` command.
const CHANGED_HOST_KEY_HINT = "if the host was recreated, remove its old key from the known_hosts line named above"

/** Returns the hints for a host that couldn't be prepared, from its failure, each guarded by the failure it fixes. */
export const getPreparationFailureHints = (target: string, failure: Error): string[] => {
  const failureMessage = messageChain(failure)

  // Match ssh's banner for a key that differs from the one in `known_hosts`. Check it first, because ssh ends it with
  // `Host key verification failed` too. Offer no way around it, because a changed key can mean a different host.
  if (failureMessage.includes("REMOTE HOST IDENTIFICATION HAS CHANGED")) return [CHANGED_HOST_KEY_HINT]

  // Match the line ssh ends an unknown host with under `StrictHostKeyChecking yes`, which the user chose.
  if (failureMessage.includes("Host key verification failed"))
    return [`run 'ssh ${target}' once to check the host's key and save it`]

  return []
}
