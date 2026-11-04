import { type } from "arktype"

import type { Mode } from "#cli/program.ts"
import type { EnsureComparison } from "#session/handlers/ensure/check.ts"
import type { FileComparison } from "#session/handlers/file/comparison.ts"
import type { ChangeTools, ReadTools } from "#session/handlers/tools.ts"
import type { Shell } from "#session/shell.ts"

// Refuse an empty name, path, or command.
// An empty command is a `sh` syntax error, and an empty name leaves a blank in the output.
export const nonEmptyStringSchema = type("string > 0")

/** The steps that tell a script about the host. */
type ReadStepKind = "read" | "inspect"

/** The steps that can change the host, whether or not they do. */
export type ChangeStepKind = "file" | "ensure" | "run"

export type StepKind = ReadStepKind | ChangeStepKind

/** What a step's handler is given: the step's name, and the session's mode, shell, home directory, and tools. */
export interface StepContext {
  stepName: string
  mode: Mode
  shell: Shell
  /** The SSH user's home directory, read when the host is prepared. It's empty when `$HOME` isn't set. */
  home: string
  /** Given to a check function. */
  readTools: ReadTools
  /** Given to a fix or run function. */
  changeTools: ChangeTools
}

/**
 * How a step turned out, which the session records for the output. A `changed` status means the host's state differed,
 * so it is the only status that counts as drift in `plan`. A `ran` status means a run was triggered. A `waiting` status
 * means a step it needs would change, so `plan` skipped reading the host's state. An `observed` status is a read or an
 * inspect.
 */
export type StepOutcome =
  | { status: "unchanged"; changed: false }
  // A read or an inspect only looks, so it has a status of its own.
  | { status: "observed"; changed: false }
  // `values` holds the values compared before the fix.
  | { status: "changed"; changed: true; values: ComparisonValues }
  | { status: "ran"; changed: true }
  // `needs` holds the names of the needed steps that would change or are waiting.
  | { status: "waiting"; changed: true; needs: string[] }

/** What a step's handler gives: the outcome to record, and the value to give the script. */
export interface HandlerReturn<T> {
  outcome: StepOutcome
  value: T
}

/** How the host's state compared with what a step wants. */
export type ComparisonValues = EnsureComparison | FileComparison
