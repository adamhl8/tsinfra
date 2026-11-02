import { type } from "arktype"

import type { Mode } from "#cli/program.ts"
import type { StepKind } from "#session/session.ts"
import type { Shell } from "#session/shell.ts"
import type { ChangeTools, CheckTools } from "#session/step-functions/tools.ts"

/** What a step gives back to the script. `K` is the method on `h` that ran it, so `needs` can refuse a run's result. */
export interface StepResult<K extends StepKind = StepKind> {
  /** The step's name, which the output shows when another step needs this one. */
  name: string
  kind: K
  /**
   * True when the step changed something, or might in `plan` because it would change or waits on a step it needs. A
   * follow-up guarded by it shows up in the plan too.
   */
  changed: boolean
}

// Check the step results a script passes in, because a script can get past the types, like with `as` or `@ts-ignore`.
// Declare it against `StepResult`, so the schema and the interface can't drift apart.
export const stepResultSchema = type.declare<StepResult>().type({
  name: "string",
  kind: "'read' | 'inspect' | 'ensure' | 'run'",
  changed: "boolean",
})

/** The steps a run can follow: ones that change the host, including another run. */
export type TriggerSteps = StepResult<"ensure" | "run">[]

/** The earlier steps a step's check depends on. Only steps with a check can be needed, so a run's result is refused. */
export type NeededSteps = StepResult<"ensure">[]

// Check `needs` at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Wrap it in an object, so the error names the field, like `needs[0] must be an object`.
export const needsSchema = type.declare<{ needs?: NeededSteps }>().type({
  "needs?": stepResultSchema.and({ kind: "'ensure'" }).array(),
})

/** What a check gave and what it wanted, as raw values. `kind` says how the output shows them. */
export type Comparison =
  | { kind: "string"; got: string; want: string }
  | { kind: "boolean"; got: boolean; want: boolean }
  // `got` is the exit code, and `want: true` means exit 0.
  | { kind: "exit"; got: number; want: boolean }

/**
 * What a step reports to the session. The script only gets `changed`, and the rest is for the output. A `changed`
 * status means a check did not pass, so it is the only status that counts as drift in `plan`. A `ran` status means a
 * run was triggered. A `waiting` status means a step it needs would change, so `plan` skipped its check.
 */
export type StepDetails =
  | { status: "unchanged"; changed: false }
  // `comparison` holds the values from the check before the fix.
  | { status: "changed"; changed: true; comparison: Comparison }
  | { status: "ran"; changed: true }
  // `needs` holds the names of the needed steps that would change or are waiting.
  | { status: "waiting"; changed: true; needs: string[] }

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
