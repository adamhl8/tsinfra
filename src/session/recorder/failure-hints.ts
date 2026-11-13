import { isErr, messageChain } from "ts-explicit-errors"

import type { ValidHostOptions } from "#hosts/hosts.ts"
import type { CommandRecord, FailureHint } from "#session/recorder/records.ts"

/**
 * Returns what each command that failed printed about why: its stderr for a non-zero exit, or its error's message for
 * one that couldn't run, which is where ssh's own stderr goes when ssh fails.
 */
const getFailureTexts = (commandRecords: CommandRecord[]): string[] =>
  commandRecords.flatMap(({ output }) => {
    if (output === undefined) return []
    if (isErr(output)) return [messageChain(output)]
    return output.exitCode === 0 ? [] : [output.stderr]
  })

/**
 * Returns the hints for a failure, from the commands that ran up to it, during preparation or in the step that failed.
 * Each hint is guarded by the failure it fixes.
 */
export const getFailureHints = (
  target: string,
  hostOptions: ValidHostOptions,
  commandRecords: CommandRecord[],
): FailureHint[] => {
  const failureTexts = getFailureTexts(commandRecords)
  const hasFailedWith = (text: string) => failureTexts.some((failureText) => failureText.includes(text))

  // Match ssh's banner for a key that differs from the one in `known_hosts`. Check it first, because ssh ends it with
  // `Host key verification failed` too. Offer no way around it, because a changed key can mean a different host.
  if (hasFailedWith("REMOTE HOST IDENTIFICATION HAS CHANGED")) return [{ kind: "changedHostKey" }]

  // Match the line ssh ends an unknown host with under `StrictHostKeyChecking yes`, which the user chose.
  if (hasFailedWith("Host key verification failed")) return [{ kind: "unknownHostKey", target }]

  // Hint at the `sudo` option only on a host that leaves it off, because a host that sets it already did the fix.
  // Match the line `sudo -n` prints when it needs a password. It's English only, so another locale gets no hint.
  if (hostOptions.sudo === false && hasFailedWith("sudo: a password is required")) return [{ kind: "sudoOption" }]

  return []
}
