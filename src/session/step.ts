import { type } from "arktype"

import type { Mode } from "#mode.ts"
import type {
  EnsureComparisonValues,
  FileComparisonValues,
  LinkComparisonValues,
  Converge,
  SudoOptions,
  ChangeTools,
  ReadTools,
} from "#session/handlers/handlers.ts"
import type { Shell } from "#transport/transport.ts"

// Refuse an empty name, path, or command.
// An empty command is a `sh` syntax error, and an empty name leaves a blank in the output.
export const nonEmptyStringSchema = type("string > 0")

/** Removes the options `callStep` handles from `T`, leaving the ones a step's handler validates. */
export type HandlerOptions<T> = Omit<T, keyof SudoOptions>

const READ_STEP_KINDS = ["read", "inspect"] as const
export const CHANGE_STEP_KINDS = ["file", "link", "ensure", "run"] as const

export type StepKind = ReadStepKind | ChangeStepKind

/** The steps that tell a script about the host. */
type ReadStepKind = (typeof READ_STEP_KINDS)[number]

/** The steps that can change the host, whether or not they do. */
export type ChangeStepKind = (typeof CHANGE_STEP_KINDS)[number]

/**
 * What a step's handler is given: the step's name and kind, and the session's mode, shell, home directory, tools, and
 * `converge`. `K` keeps a step's kind in its type, so a script can't give a run's result to `needs`.
 */
export interface StepContext<K extends StepKind = StepKind> {
  stepName: string
  kind: K
  mode: Mode
  shell: Shell
  /** The SSH user's home directory, read when the host is prepared. It's empty when `$HOME` isn't set. */
  home: string
  /** Given to a check function. */
  readTools: ReadTools
  /** Given to a fix or run function. */
  changeTools: ChangeTools
  converge: Converge
}

/** What a step's handler gives: the status to record, and the value to give the script. */
export interface HandlerReturn<T> {
  status: StepStatus
  value: T
}

/**
 * How a step turned out, which the session records for the output. A `changed` status means the host's state differed,
 * so it is the only status that counts as drift in `plan`. A `ran` status means a run was triggered. A `waiting` status
 * means a step it needs would change, so `plan` skipped reading the host's state. An `observed` status is a read or an
 * inspect, which only looks.
 */
export type StepStatus = "unchanged" | "observed" | "changed" | "ran" | "waiting"

/** How the host's state compared with what a step wants. */
export type ComparisonValues = EnsureComparisonValues | FileComparisonValues | LinkComparisonValues
