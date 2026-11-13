import type { Result } from "ts-explicit-errors"

import type {
  Comparison,
  EnsureOptions,
  FileOptions,
  LinkOptions,
  StepShellOptions,
  Want,
} from "#session/handlers/handlers.ts"
import type { StepKind, StepStatus } from "#session/step.ts"
import type { CommandOutput } from "#transport/transport.ts"

/** Returns a new, empty record for the host `name` on `target`, which preparation and the session both record on. */
export const createHostRecord = (name: string, target: string): HostRecord => ({
  name,
  target,
  preparationCommands: [],
  runningStep: undefined,
  stepRecords: [],
})

export interface HostRecord {
  name: string
  target: string
  /** Every command preparation ran on the host, before its script ran. */
  preparationCommands: CommandRecord[]
  /** The step that's running, until it finishes and joins `stepRecords`, or fails and becomes the failure's. */
  runningStep: StepRecord | undefined
  /** Every step that finished, in the order the script called them. The step that failed is the failure's. */
  stepRecords: FinishedStepRecord[]
  /** The host's one failure, if it failed, and where it came from. */
  failure?: RecordedFailure
}

/** A host's failure: one that no step owns, or a step's. */
export type RecordedFailure = RecordedUnownedFailure | RecordedStepFailure

interface BaseRecordedFailure {
  error: Error
  /** How to fix the failure, which the report shows under it. */
  hints: FailureHint[]
}

/** A way to fix a failure, recorded as its kind, so the report picks the words. */
export type FailureHint =
  // ssh found a key that differs from the one in `known_hosts`.
  | { kind: "changedHostKey" }
  // ssh found no key for the host in `known_hosts`, under `StrictHostKeyChecking yes`.
  | { kind: "unknownHostKey"; target: string }
  // sudo needs a password on a host that leaves the `sudo` option off.
  | { kind: "sudoOption" }

/** A failure no step owns: one from preparation, or one the host function threw outside any step, for `host fn`. */
export interface RecordedUnownedFailure extends BaseRecordedFailure {
  kind: "preparation" | "host fn"
}

/** A step's failure, with the record of the step that failed. */
export interface RecordedStepFailure extends BaseRecordedFailure {
  kind: "step"
  stepRecord: StepRecord
}

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
}

const NO_VARIABLES: Record<string, string> = {}

/**
 * The defaults of the options a step's record holds, so the recorder leaves out any option still at its default. Each
 * schema declares its own defaults, and the tests that record a step with no options catch any default that differs.
 * Check it against `StepOptionsRecord`, so an option added, removed, or retyped there fails to compile here. Leave out
 * `validate`, because it has no default.
 */
export const RECORDED_OPTION_DEFAULTS = {
  sudo: false,
  env: NO_VARIABLES,
  secretEnv: NO_VARIABLES,
  secret: false,
  overwrite: true,
  force: false,
  verify: true,
} satisfies Required<Omit<StepOptionsRecord, "validate">>

/** Every option a step's record can hold: the shell options, then the step's own options that the report shows. */
export interface StepOptionsRecord
  extends
    StepShellOptions,
    Pick<FileOptions, "secret" | "overwrite">,
    Pick<LinkOptions, "force">,
    Pick<EnsureOptions<Want>, "verify"> {
  /**
   * `validate`'s command, which the record holds in place of the function the script passed. Unset for a step without
   * one.
   */
  validate?: string | undefined
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

interface StepComparisons {
  before?: Comparison
  after?: Comparison
}
