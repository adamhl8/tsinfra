import { type } from "arktype"

import type { Mode } from "#cli/program.ts"
import type { StepKind } from "#session/session.ts"
import type { Shell } from "#session/shell.ts"
import type { ChangeTools, CheckTools } from "#session/step-functions/tools.ts"
import type { ValueComparison } from "#session/steps/ensure.ts"
import type { FileComparison } from "#session/steps/file/comparison.ts"

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

// Validate the step results a script passes in, because a script can get past the types, like with `as` or `@ts-ignore`.
// Declare it against `StepResult`, so the schema and the interface can't drift apart.
export const stepResultSchema = type.declare<StepResult>().type({
  name: "string",
  kind: "'read' | 'inspect' | 'file' | 'ensure' | 'run'",
  changed: "boolean",
})

// Accept only steps that read the host's state in `needs`, so not a run.
export const neededStepsSchema = stepResultSchema.and({ kind: "'file' | 'ensure'" }).array()
export type NeededSteps = typeof neededStepsSchema.infer

// Refuse an empty name, path, or command.
// An empty command is a `sh` syntax error, and an empty name leaves a blank in the output.
export const nonEmptyStringSchema = type("string > 0")

/** What a step's handler is given: the step's name, and the session's mode, shell, home directory, and tools. */
export interface StepContext {
  stepName: string
  mode: Mode
  shell: Shell
  /** The SSH user's home directory, read when the session starts. It's empty when `$HOME` isn't set. */
  home: string
  /** Given to a check function. */
  checkTools: CheckTools
  /** Given to a fix or run function. */
  changeTools: ChangeTools
}

/**
 * What a step reports to the session. The script only gets `changed`, and the rest is for the output. A `changed`
 * status means the host's state differed, so it is the only status that counts as drift in `plan`. A `ran` status means
 * a run was triggered. A `waiting` status means a step it needs would change, so `plan` skipped reading the host's
 * state. An `observed` status is a read or an inspect.
 */
export type StepDetails =
  | { status: "unchanged"; changed: false }
  // A read or an inspect only looks, so it has a status of its own.
  | { status: "observed"; changed: false }
  // `comparison` holds the values read from the host before the fix.
  | { status: "changed"; changed: true; comparison: Comparison }
  | { status: "ran"; changed: true }
  // `needs` holds the names of the needed steps that would change or are waiting.
  | { status: "waiting"; changed: true; needs: string[] }

/** How the host's state compared with what a step wants. */
export type Comparison = ValueComparison | FileComparison
