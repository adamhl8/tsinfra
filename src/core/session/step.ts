import { type } from "arktype"

import type { HomeDirectory } from "#core/hosts/prepare/host-details/facts/home.ts"
import type { StepOptionsToRecord } from "#core/recorder/records/options.ts"
import type { ConvergeRecorder } from "#core/recorder/session-recorder.ts"
import type { SavedStateManager } from "#core/saved-state.ts"
import type { EnsureComparisonValues } from "#core/session/handlers/ensure/comparison.ts"
import type { FileComparisonValues } from "#core/session/handlers/file/comparison.ts"
import type { LinkComparisonValues } from "#core/session/handlers/link/comparison.ts"
import type { PathAttributeClaim } from "#core/session/handlers/shared/filesystem/attributes/claims.ts"
import type { ChangeTools, ReadTools } from "#core/session/handlers/tools.ts"
import type { Shell } from "#core/transport/shell.ts"
import type { Mode } from "#mode.ts"

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

/**
 * What a step's handler is given: the step's name and kind, and the session's mode, shell, home directory, saved state,
 * tools, and recorders. `K` keeps a step's kind in its type, so a script can't give a run's result to `needs`.
 */
export interface StepContext<K extends StepKind = StepKind> {
  stepName: string
  kind: K
  mode: Mode
  shell: Shell
  /** The SSH user's home directory, read and checked when the host is prepared. */
  home: HomeDirectory
  /**
   * The host's saved state, which says whether a step's change is still open, and which a follow-up opens its own
   * change in and records itself on.
   */
  savedStateManager: SavedStateManager
  /**
   * The names of the change steps that changed in this pass, shared by the session's steps. A result's `changed` is the
   * script's value instead, which a change still open from an earlier apply also makes true.
   */
  changedStepNames: Set<string>
  /** The names of the runs in `changedStepNames` that run on every pass, so a run that follows only them does too. */
  ranAlwaysStepNames: Set<string>
  /**
   * The claims steps made on each path's attributes, by its resolved path, so two steps can't set one differently. A
   * file's and a directory's are under their own path, and a link's `targetAttributes` are under its target.
   */
  pathAttributeClaims: Map<string, PathAttributeClaim[]>
  /** Given to a check function. */
  readTools: ReadTools
  /** Given to a fix or run function. */
  changeTools: ChangeTools
  convergeRecorder: ConvergeRecorder
  /**
   * Records the options the step was given that the report shows, like `validate`'s command. The recorder leaves out
   * each one at its default, and records `input` as a stand-in. Call it right after validating them, so a failure can't
   * lose them.
   */
  recordOptions: (options: StepOptionsToRecord) => void
}

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
