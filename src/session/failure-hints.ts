import { isErr } from "ts-explicit-errors"

import type { ValidHostOptions } from "#hosts/host.ts"
import type { CommandRecord } from "#session/step-recorder.ts"

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
export const getFailureHints = (hostOptions: ValidHostOptions, commandRecords: CommandRecord[]): string[] => {
  // Hint at the `sudo` option only on a host that leaves it off, because a host that sets it already did the fix.
  // Match the line `sudo -n` prints when it needs a password. It's English only, so another locale gets no hint.
  if (hostOptions.sudo === false && hasFailedWithStderr(commandRecords, "sudo: a password is required"))
    return [SUDO_OPTION_HINT]

  return []
}
