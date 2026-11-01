import type { Mode } from "#cli/program.ts"
import type { Shell } from "#session/shell.ts"
import type { ChangeTools, CheckTools } from "#session/step-functions/tools.ts"

export interface StepResult {
  /** True when the step changed something, or would in `plan`, so a follow-up guarded by it shows up in the plan too. */
  changed: boolean
}

/** What a check gave and what it wanted, as raw values. `kind` says how the output shows them. */
export type Comparison =
  | { kind: "string"; got: string; want: string }
  | { kind: "boolean"; got: boolean; want: boolean }
  // `got` is the exit code, and `want: true` means exit 0.
  | { kind: "exit"; got: number; want: boolean }

/**
 * What a step reports to the session. The script's type only shows `changed`, and the rest is for the output. A
 * `changed` status means a check did not pass, so it is the only status that counts as drift in `plan`. A `ran` status
 * means a run's `when` was true.
 */
export type StepDetails =
  | { status: "unchanged"; changed: false }
  // `comparison` holds the values from the check before the fix.
  | { status: "changed"; changed: true; comparison: Comparison }
  | { status: "ran"; changed: true }

/** What stays the same for one call of a step, like `h.ensure` or `h.run`. */
export interface StepCall {
  shell: Shell
  mode: Mode
  stepName: string
  /** Given to a check function. */
  checkTools: CheckTools
  /** Given to a fix or run function. */
  changeTools: ChangeTools
}
