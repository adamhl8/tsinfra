import { type } from "arktype"

import type { Mode } from "#cli/program.ts"
import type { EnsureComparisonValues } from "#session/handlers/ensure/check.ts"
import type { FileComparisonValues } from "#session/handlers/file/comparison.ts"
import type { ChangeTools, ReadTools } from "#session/handlers/tools.ts"
import type { Shell } from "#session/shell.ts"

// Refuse an empty name, path, or command.
// An empty command is a `sh` syntax error, and an empty name leaves a blank in the output.
export const nonEmptyStringSchema = type("string > 0")

const READ_STEP_KINDS = ["read", "inspect"] as const
export const CHANGE_STEP_KINDS = ["file", "ensure", "run"] as const

export type StepKind = ReadStepKind | ChangeStepKind

/** The steps that tell a script about the host. */
type ReadStepKind = (typeof READ_STEP_KINDS)[number]

/** The steps that can change the host, whether or not they do. */
export type ChangeStepKind = (typeof CHANGE_STEP_KINDS)[number]

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

/** What a step's handler gives: the outcome to record, and the value to give the script. */
export interface HandlerReturn<T> {
  outcome: StepOutcome
  value: T
}

/**
 * How a step turned out, which the session records for the output. A `changed` status means the host's state differed,
 * so it is the only status that counts as drift in `plan`. A `ran` status means a run was triggered. A `waiting` status
 * means a step it needs would change, so `plan` skipped reading the host's state. An `observed` status is a read or an
 * inspect.
 */
export type StepOutcome =
  | { status: "unchanged" }
  // A read or an inspect only looks, so it has a status of its own.
  | { status: "observed" }
  // `values` holds the values compared before the fix.
  | { status: "changed"; values: ComparisonValues }
  | { status: "ran" }
  // `needs` holds the names of the needed steps that would change or are waiting.
  | { status: "waiting"; needs: string[] }

/** How the host's state compared with what a step wants. */
export type ComparisonValues = EnsureComparisonValues | FileComparisonValues
