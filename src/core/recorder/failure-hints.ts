import { isErr, messageChain } from "ts-explicit-errors"

import type { ValidHostOptions } from "#core/hosts/host.ts"
import type { CommandRecord } from "#core/recorder/records/command.ts"
import type { SshFailureHint } from "#core/transport/ssh.ts"
import { getSshFailureHint } from "#core/transport/ssh.ts"
import type { SudoFailureHint } from "#core/transport/sudo.ts"
import { getSudoFailureHint } from "#core/transport/sudo.ts"

/**
 * A way to fix a failure, recorded as its kind, so the report picks the words. Each rule in `FAILURE_HINT_RULES` gives
 * one.
 */
export type FailureHint = SshFailureHint | SudoFailureHint

/** What every rule may need to know about the host. Each rule declares the part it reads. */
interface FailureHintContext {
  target: string
  hasSudoOption: boolean
}

/** Returns the hint for a failure that `failureTexts` show, or undefined when they don't show the one it fixes. */
type FailureHintRule = (hintContext: FailureHintContext, failureTexts: string[]) => FailureHint | undefined

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

// Give each tool's rule, which lives beside the transport that runs the tool.
const FAILURE_HINT_RULES: FailureHintRule[] = [getSshFailureHint, getSudoFailureHint]

/** Returns the hints for a failure, from the commands that ran up to it, during preparation or in the step that failed. */
export const getFailureHints = (
  target: string,
  hostOptions: ValidHostOptions,
  commandRecords: CommandRecord[],
): FailureHint[] => {
  const failureTexts = getFailureTexts(commandRecords)
  const hintContext: FailureHintContext = { target, hasSudoOption: hostOptions.sudo !== false }
  return FAILURE_HINT_RULES.flatMap((getHint) => getHint(hintContext, failureTexts) ?? [])
}
