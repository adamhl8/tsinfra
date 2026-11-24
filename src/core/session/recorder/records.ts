import type { Result } from "ts-explicit-errors"

import type { EnsureOptions } from "#core/session/handlers/ensure.ts"
import type { Want } from "#core/session/handlers/ensure/want.ts"
import type { FileOptions } from "#core/session/handlers/file.ts"
import type { LinkOptions } from "#core/session/handlers/link.ts"
import type { MessageKind } from "#core/session/handlers/log.ts"
import type { InputOptions, MaskOptions } from "#core/session/handlers/options/command.ts"
import type { StepShellOptions } from "#core/session/handlers/options/step.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import type { ToolName, ToolOptions } from "#core/session/handlers/tools.ts"
import type { StepKind, StepStatus } from "#core/session/step.ts"
import type { CommandOutput } from "#core/transport.ts"

/** Returns a new, empty record for the host `name` on `target`, which preparation and the session both record on. */
export const createHostRecord = (name: string, target: string): HostRecord => ({
  name,
  target,
  preparationCommands: [],
  runningStep: undefined,
  entries: [],
})

/** Returns the records of the steps a host finished, in order, without the host messages between them. */
export const getFinishedStepRecords = (hostRecord: HostRecord): FinishedStepRecord[] =>
  hostRecord.entries.filter((entry) => entry.kind !== "hostMessage")

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

/** A failure no step owns: one from preparation, or one the session recorded outside any step. */
export type RecordedUnownedFailure = RecordedPreparationFailure | RecordedSessionFailure

/** A failure while the host was prepared, before its script ran. */
interface RecordedPreparationFailure extends BaseRecordedFailure {
  kind: "preparation"
}

/**
 * A failure the session recorded outside any step: one the host function threw, for `host fn`, or one from closing the
 * open changes in the host's saved state after the host function finished, for `saved state`.
 */
interface RecordedSessionFailure extends BaseRecordedFailure {
  kind: "host fn" | "saved state"
}

/** The kinds of failure the session records outside any step. */
export type SessionFailureKind = RecordedSessionFailure["kind"]

/** A step's failure, with the record of the step that failed. */
interface RecordedStepFailure extends BaseRecordedFailure {
  kind: "step"
  stepRecord: StepRecord
}

/** One entry of a host's record: a step that finished, or a host message. */
export type EntryRecord = FinishedStepRecord | HostMessageRecord

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

/** A message the script logged with `h.log`: a host message or a step message. */
interface BaseMessageRecord {
  messageKind: MessageKind
  text: string
}

/** A host message: one the script logged outside a step, which the report shows between the steps around it. */
export interface HostMessageRecord extends BaseMessageRecord {
  kind: "hostMessage"
}

/** A step message: one a step's function logged. */
export interface StepMessageRecord extends BaseMessageRecord {
  /** The part of `converge` that was running. Unset for a step that doesn't converge. */
  phase?: ConvergePhase
  /** How many of the step's commands were recorded when it was logged, which places it among them. */
  commandCount: number
}

const NO_VARIABLES: Record<string, string> = {}

/**
 * The defaults of the options a step's or a tool call's record holds, so the recorder leaves out any option still at
 * its default. Each schema declares its own defaults, and the tests that record a step with no options catch any
 * default that differs. Check it against `RecordableOptions`, so an option added, removed, or retyped there fails to
 * compile here. Leave out `validate` and `input`, because they have no default.
 */
export const RECORDED_OPTION_DEFAULTS = {
  sudo: false,
  env: NO_VARIABLES,
  secretEnv: NO_VARIABLES,
  secret: false,
  overwrite: true,
  force: false,
  verify: true,
  maskOutput: false,
} satisfies Required<Omit<RecordableOptions, "validate" | "input">>

/**
 * Every option a step's or a tool call's record can hold, as the handler or the tool gives it: the shell options, then
 * the step's own options that the report shows. A tool call's are the ones `ToolOptions` names.
 */
interface RecordableOptions
  extends
    StepShellOptions,
    Pick<FileOptions, "secret" | "overwrite">,
    Pick<LinkOptions, "force">,
    Pick<EnsureOptions<Want>, "verify">,
    InputOptions,
    MaskOptions {
  /** `validate`'s command, which the handler builds from the function the script passed. */
  validate?: string
}

/**
 * What the record holds in place of each option it never holds as given, like `input`, which may be a secret, and can
 * be large. Any other option is recorded as given.
 */
export const RECORDED_STAND_INS = { input: "<content>" } as const satisfies {
  [K in keyof RecordableOptions]?: string
}

/** What `recordOptions` takes. Each option can be unset, and the recorder leaves out what's unset. */
export type StepOptionsToRecord = { [K in keyof RecordableOptions]?: RecordableOptions[K] | undefined }

/** The options a step's record holds: each one as given, or its stand-in. */
export type StepOptionsRecord = {
  [K in keyof RecordableOptions]: K extends keyof typeof RECORDED_STAND_INS
    ? (typeof RECORDED_STAND_INS)[K]
    : RecordableOptions[K]
}

export interface CommandRecord {
  cmd: string
  /** A short name for a command tsinfra wrote itself. Unset for a script's command. */
  label?: string
  /** The tool call that ran the command. Unset for a step's own command and for tsinfra's. */
  toolCall?: ToolCallRecord
  /** The part of `converge` that ran the command. Unset for a step that doesn't converge. */
  phase?: ConvergePhase
  /** Unset until the command finishes. */
  output?: Result<CommandOutput>
}

/** A tool call a step's function made: the tool the script called, and the options it set. */
export interface ToolCallRecord {
  toolName: ToolName
  /** The options the call set that the report shows, recorded like a step's. */
  options: ToolOptionsRecord
}

/** The options a tool call's record holds: each one as given, or its stand-in. */
type ToolOptionsRecord = Pick<StepOptionsRecord, keyof ToolOptions>

/** The parts of `converge` that run commands, in order. */
export type ConvergePhase = "before" | "fix" | "after"

interface StepComparisons {
  before?: Comparison
  after?: Comparison
}
