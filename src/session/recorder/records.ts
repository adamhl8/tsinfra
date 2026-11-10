import type { Result } from "ts-explicit-errors"

import type { Comparison } from "#session/handlers/handlers.ts"
import type { StepKind, StepStatus } from "#session/step.ts"
import type { CommandOutput } from "#transport/transport.ts"

export interface HostRecord {
  name: string
  target: string
  /** Every command preparation ran on the host, before its script ran. */
  preparationCommands: CommandRecord[]
  /** Every step that started, in the order the script called them. */
  stepRecords: StepRecord[]
  /** The host's one failure, if it failed, and where it came from. */
  failure?: RecordedFailure
}

/** A host's failure: one that no step owns, or a step's. */
export type RecordedFailure = RecordedUnownedFailure | RecordedStepFailure

interface BaseRecordedFailure {
  error: Error
  /** How to fix the failure, which the report shows under it. */
  hints: string[]
}

/** A failure no step owns: one from preparation, or one the host function threw outside any step, for `host fn`. */
export interface RecordedUnownedFailure extends BaseRecordedFailure {
  kind: "preparation" | "host fn"
}

/** A step's failure, with the record of the step that failed. */
export interface RecordedStepFailure extends BaseRecordedFailure {
  kind: "step"
  stepRecord: StepRecord
}

export interface StepRecord {
  /** The name the script gave the step, or a read step's command. */
  name: string
  kind: StepKind
  /** Unset until the step finishes, and on a failed step, whose outcome is the host record's `failure`. */
  status?: StepStatus
  commands: CommandRecord[]
  comparisons: StepComparisons
  /** The names of the needed steps this step waited on. */
  waitingOn: string[]
}

interface StepComparisons {
  before?: Comparison
  after?: Comparison
}

export interface CommandRecord {
  cmd: string
  /** A short name for a command tsinfra wrote itself. Unset for a script's command. */
  label?: string
  /** The part of `converge` that ran the command. Unset for a step that doesn't converge. */
  phase?: ConvergePhase
  /** Unset until the command finishes. */
  output?: Result<CommandOutput>
}

/** The parts of `converge` that run commands, in order. */
export type ConvergePhase = "before" | "fix" | "after"
