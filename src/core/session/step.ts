import { type } from "arktype"

import type { EnsureComparisonValues } from "#core/session/handlers/ensure/comparison.ts"
import type { FileComparisonValues } from "#core/session/handlers/file/comparison.ts"
import type { LinkComparisonValues } from "#core/session/handlers/link/comparison.ts"

// Refuse an empty name, path, or command.
// An empty command is a `sh` syntax error, and an empty name leaves a blank in the output.
export const nonEmptyStringSchema = type("string > 0")

const READ_STEP_KINDS = ["read", "inspect"] as const
export const CHANGE_STEP_KINDS = ["file", "link", "dir", "ensure", "run"] as const

export type StepKind = ReadStepKind | ChangeStepKind

/** The steps that tell a script about the host. */
type ReadStepKind = (typeof READ_STEP_KINDS)[number]

/** The steps that can change the host, whether or not they do. */
export type ChangeStepKind = (typeof CHANGE_STEP_KINDS)[number]

/** Reports whether `kind` is a step that can change the host. */
export const isChangeStepKind = (kind: StepKind): kind is ChangeStepKind =>
  CHANGE_STEP_KINDS.some((changeStepKind) => changeStepKind === kind)

const PATH_STEP_KINDS = ["file", "link", "dir"] as const satisfies ChangeStepKind[]

/** The change steps named by the path they manage. */
type PathStepKind = (typeof PATH_STEP_KINDS)[number]

/** Reports whether `kind` is a step named by the path it manages. */
export const isPathStepKind = (kind: StepKind): kind is PathStepKind =>
  PATH_STEP_KINDS.some((pathStepKind) => pathStepKind === kind)

/** What a step's handler gives: the status to record, and the value to give the script. */
export interface HandlerReturn<T> {
  status: StepStatus
  value: T
}

/**
 * How a step turned out, which the session records for the output. A `changed` status means the host's state differed,
 * which is drift in `plan`. A `ran` status means a run was triggered. A `ranAlways` status means a run runs on every
 * pass, because its `after` is `"always"`, or it follows only runs that do. A `ranFromOpenChanges` status means only
 * changes still open from an earlier apply triggered a run, which is drift in `plan` too, because nothing in the pass
 * explains it. A `resume` status means a change step was in sync, but its change is still open from an earlier apply. A
 * `waiting` status means a step it needs would change, so `plan` skipped reading the host's state. An `observed` status
 * is a read or an inspect, which only looks.
 */
export type StepStatus = "unchanged" | "observed" | "changed" | FollowUpStatus | "waiting" | "resume"

/** The statuses only a follow-up gets, each for a reason it ran. */
export type FollowUpStatus = "ran" | "ranAlways" | "ranFromOpenChanges"

/** How the host's state compared with what a step wants. */
export type ComparisonValues = EnsureComparisonValues | FileComparisonValues | LinkComparisonValues
