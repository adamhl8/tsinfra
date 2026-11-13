import { toHostBlockEntries } from "#report/host-block/entries.ts"
import type { Verbosity } from "#report/verbosity.ts"
import type {
  ConvergePhase,
  EnsureComparisonValues,
  FailureHint,
  FileComparisonValues,
  HostRecord,
  LinkComparisonValues,
  RecordedUnownedFailure,
  StepKind,
  StepStatus,
} from "#session/session.ts"

/** The levels a piece of a block shows at: from `from`, up to `until` when it has one. The builder decides both. */
export interface PieceLevels {
  from: Verbosity
  until?: Verbosity
}

/** A host's block: its name, then its entries, or "no steps" for a script that made none and didn't fail. */
export type HostBlock = { name: string } & ({ kind: "entries"; entries: HostBlockEntry[] } | { kind: "noSteps" })

/**
 * One entry of a host block: a step, or the one failure no step owns. Its levels are where its own line shows, and it
 * also shows when a note part or a detail inside it shows.
 */
export interface HostBlockEntry extends PieceLevels {
  status: EntryStatus
  /** What the entry is about, which shows before the name. */
  kind: EntryKind
  name: EntryName
  /** The note's parts, which show after the name, joined with `, `. Empty when the entry has no note. */
  note: NotePart[]
  /** How a value would change, or for a failure, what the step last found on the host. */
  details: Detail[]
  /** Why the entry failed. */
  error?: Error
}

export type EntryStatus = StepStatus | "failed"

/** What a host block entry is about: a kind of step, or a failure no step owns. */
export type EntryKind = StepKind | UnownedFailureKind

/** Where a failure no step owns happened: in preparation, or in the host function, for `host fn`. */
type UnownedFailureKind = RecordedUnownedFailure["kind"]

/** A host block entry's name, and what kind of name it is, which decides how it's styled. */
export interface EntryName {
  text: string
  kind: NameKind
}

export type NameKind =
  // A name the script gave the step.
  | "step"
  // A name that's a value: a read's or an inspect's command, a file's or a link's path, or a target.
  | "value"

/** One part of an entry's note, like `needs 'A', 'B'`, the names of the steps a waiting step needs. */
export interface NotePart extends PieceLevels {
  kind: "needs"
  needs: string[]
}

/** One thing an entry shows under its status line, in the order they show, with the levels it shows at. */
export type Detail = PieceLevels
  // The options the script set that change how the step's commands ran, like `sudo`.
  & (
    | { kind: "options"; options: StepOption[] }
    | { kind: "diff"; got: string; want: string }
    // Holds everything about a file but a text diff, which is a detail of its own.
    | { kind: "fileComparisonValues"; values: FileComparisonValues }
    | { kind: "linkComparisonValues"; values: LinkComparisonValues }
    | { kind: "ensureComparisonValues"; values: EnsureComparisonValues }
    // The stderr of a command that can explain a failure that still differs after its fix.
    | { kind: "stderr"; command: string; stderr: string }
    // tsinfra's own aside about the details around it.
    | { kind: "note"; note: DetailNote }
    // Something that worked, but needs a look, like a link to a path where nothing exists.
    | { kind: "warning"; warning: StepWarning }
    // The commands the step ran, in the order they ran.
    | { kind: "commands"; commands: StepCommand[] }
    // What a read or inspect step's one command printed, because the step lists no commands to show it under.
    | { kind: "commandOutput"; output: CommandOutputDetail }
    // How to fix a failure, like setting the host's `sudo` option.
    | { kind: "hint"; hint: FailureHint }
  )

/**
 * One option the script set on a step, like `sudo`, or one entry of an option, like a variable of `env`. Its name
 * always shows with the options detail. Its value is a piece of its own, which the filter leaves out below its level.
 */
export interface StepOption {
  name: string
  value?: OptionValue
  entries: StepOption[]
}

/** An option's value, with the levels it shows at. A secret value is masked. */
export interface OptionValue extends PieceLevels {
  value: string | boolean
}

/**
 * A command a step ran, and its label when tsinfra wrote it, with any secret in its text masked. Its phase and what it
 * printed are pieces of their own, which the filter leaves out below their level.
 */
export interface StepCommand {
  cmd: string
  label?: string
  /** The part of a step that compares the host's state that ran the command. Unset for a step that doesn't compare. */
  phase?: PieceLevels & { phase: ConvergePhase }
  output?: PieceLevels & CommandOutputDetail
}

/** What a command printed: its exit code and both streams, or the error it failed with when it couldn't run at all. */
export type CommandOutputDetail =
  | { kind: "exited"; exitCode: number; stdout: string; stderr: string }
  | { kind: "failed"; error: Error }

/** Something that worked but needs a look, as its kind, so the report picks the words. */
export interface StepWarning {
  kind: "missingTarget"
  target: string
}

/** Tsinfra's own aside about the details around it, as its kind, so the report picks the words. */
export type DetailNote =
  // The values from before the fix, under a failure, which may no longer be true.
  | { kind: "valuesBeforeFix" }
  // Several commands in one phase of a failed step wrote to stderr, which shows only at a higher level.
  | { kind: "commandsWroteStderr"; phase: StillDiffersPhase }
  // The host function threw outside any step.
  | { kind: "hostFunctionFailure" }

/** The phases of a step whose commands can explain why its state still differs after the fix. */
export type StillDiffersPhase = Extract<ConvergePhase, "fix" | "after">

/**
 * Returns a host's block, with every piece at every level, each with the level it shows from: an entry per finished
 * step, then the host's failure, if it failed. A host whose script made no steps and didn't fail gets "no steps"
 * instead, so it's clear the host ran.
 */
export const toHostBlock = (hostRecord: HostRecord): HostBlock => {
  const { name, stepRecords, failure } = hostRecord
  if (stepRecords.length === 0 && !failure) return { name, kind: "noSteps" }

  const entries = toHostBlockEntries(hostRecord)
  return { name, kind: "entries", entries }
}
