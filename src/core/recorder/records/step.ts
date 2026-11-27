import type { HostRecord } from "#core/recorder/records.ts"
import type { CommandRecord } from "#core/recorder/records/command.ts"
import type { StepMessageRecord } from "#core/recorder/records/message.ts"
import type { StepOptionsRecord } from "#core/recorder/records/options.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import type { StepKind, StepStatus } from "#core/session/step.ts"

/** Returns the records of the steps a host finished, in order, without the host messages between them. */
export const getFinishedStepRecords = (hostRecord: HostRecord): FinishedStepRecord[] =>
  hostRecord.entries.filter((entry) => entry.kind !== "hostMessage")

/** The record of a step that finished, with how it turned out. */
export interface FinishedStepRecord extends StepRecord {
  status: StepStatus
}

/** A step's record without an outcome: the running step, which the recorder records on, or the step that failed. */
export interface StepRecord {
  /** The name the script gave the step, or a read step's command. */
  name: string
  kind: StepKind
  /**
   * The options the step set that the report shows, by name, in the order they were recorded: the shell options first,
   * then the step's own. Each is left out when it's at its default, and each secret value is `[MASKED]`.
   */
  options: StepOptionsRecord
  commands: CommandRecord[]
  comparisons: StepComparisons
  /** The names of the needed steps this step waited on. */
  waitingOn: string[]
  /** The messages the step's functions logged, in the order they logged them. */
  messages: StepMessageRecord[]
}

interface StepComparisons {
  before: Comparison | undefined
  after: Comparison | undefined
}
