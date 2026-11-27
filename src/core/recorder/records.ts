import type { NamedFact } from "#core/hosts/prepare/host-details/facts.ts"
import type { CommandRecord } from "#core/recorder/records/command.ts"
import type { RecordedFailure } from "#core/recorder/records/failure.ts"
import type { HostMessageRecord } from "#core/recorder/records/message.ts"
import type { FinishedStepRecord, StepRecord } from "#core/recorder/records/step.ts"

/** Returns a new, empty record for the host `name` on `target`, which preparation and the session both record on. */
export const createHostRecord = (name: string, target: string): HostRecord => ({
  name,
  target,
  preparationCommands: [],
  runningStep: undefined,
  entries: [],
  warnings: [],
  failure: undefined,
})

export interface HostRecord {
  name: string
  target: string
  /** Every command preparation ran on the host, before its script ran. */
  preparationCommands: CommandRecord[]
  /** The step that's running, until it finishes and joins `entries`, or fails and becomes the failure's. */
  runningStep: StepRecord | undefined
  /**
   * Every step that finished, and every host message, in the order the script made them. The step that failed is the
   * failure's.
   */
  entries: EntryRecord[]
  /** What tsinfra found about the whole host that worked but needs a look, from its preparation. */
  warnings: HostWarningRecord[]
  /** The host's one failure, if it failed, and where it came from. */
  failure: RecordedFailure | undefined
}

/** One entry of a host's record: a step that finished, or a host message. */
export type EntryRecord = FinishedStepRecord | HostMessageRecord

/** A warning about the whole host, recorded as its kind, so the report picks the words. */
export interface HostWarningRecord {
  kind: "unknownFact"
  fact: NamedFact
  value: string
}
