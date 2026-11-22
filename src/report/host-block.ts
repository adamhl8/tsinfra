import type { EnsureComparisonValues } from "#core/session/handlers/ensure/comparison.ts"
import type { RecordComparisonValues } from "#core/session/handlers/ensure/comparison/record.ts"
import type { FileComparisonValues } from "#core/session/handlers/file/comparison.ts"
import type { LinkComparisonValues } from "#core/session/handlers/link/comparison.ts"
import type { MessageKind } from "#core/session/handlers/log.ts"
import type { ToolName } from "#core/session/handlers/tools.ts"
import type { ConvergePhase, FailureHint, HostRecord, RecordedUnownedFailure } from "#core/session/recorder/records.ts"
import type { StepKind, StepStatus } from "#core/session/step.ts"
import type { Mode } from "#mode.ts"
import { toHostBlockEntries } from "#report/host-block/entries.ts"
import type { Verbosity } from "#report/verbosity.ts"

/** The levels a piece of a block shows at: from `from`, up to `until` when it has one. The builder decides both. */
export interface PieceLevels {
  from: Verbosity
  until?: Verbosity
}

/** A host's block: its name, then its entries, or "empty script" for a host that recorded none and didn't fail. */
export type HostBlock = { name: string } & ({ kind: "entries"; entries: HostBlockEntry[] } | { kind: "noEntries" })

/** One entry of a host block: a status line, or a message logged between steps. */
export type HostBlockEntry = StatusLineEntry | MessageEntry

/**
 * An entry shown as a status line, with its details under it: a step, or the one failure no step owns. Its levels are
 * where its own line shows, and it also shows when a note part or a detail inside it shows.
 */
export interface StatusLineEntry extends PieceLevels {
  status: EntryStatus
  /** What the entry is about, which shows before the name. */
  kind: EntryKind
  /** What the entry is about. Unset for a host function failure, which the block's header already names the host of. */
  name?: EntryName
  /** The note's parts, which show after the name, joined with `, `. Empty when the entry has no note. */
  note: NotePart[]
  /** How a value would change, or for a failure, what the step last found on the host. */
  details: Detail[]
  /** Why the entry failed. */
  error?: Error
}

export type EntryStatus = StepStatus | "failed"

/** What a status line entry is about: a kind of step, or a failure no step owns. */
export type EntryKind = StepKind | UnownedFailureKind

/** Where a failure no step owns happened: in preparation, or in the host function, for `host fn`. */
export type UnownedFailureKind = RecordedUnownedFailure["kind"]

/** A message logged between steps, shown as its kind's label and its text. Its levels are where it shows. */
export interface MessageEntry extends PieceLevels {
  kind: "message"
  messageKind: MessageKind
  text: string
}

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

/** One part of an entry's note, like `needs 'A', 'B'`, which shows after the entry's name. */
export type NotePart = PieceLevels
  // The names of the steps a waiting step needs.
  & (
    | { kind: "needs"; needs: string[] }
    // A `resume` step, whose follow-ups that didn't complete in an earlier apply still trigger.
    | { kind: "resume" }
    // A `ranFromOpenChanges` follow-up, which only changes still open from an earlier apply triggered.
    | { kind: "triggeredByOpenChange" }
  )

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
    // A `dir` step's record, which shows like a file's attribute rows, with its mode in both notations.
    | { kind: "dirComparisonValues"; values: RecordComparisonValues }
    // The stderr of a command that can explain a failure that still differs after its fix.
    | { kind: "stderr"; command: string; stderr: string }
    // tsinfra's own aside about the details around it.
    | { kind: "note"; note: DetailNote }
    // Something that worked, but needs a look, like a link to a path where nothing exists.
    | { kind: "warning"; warning: StepWarning }
    // The commands the step ran, in the order they ran, grouped by the phase that ran them.
    | { kind: "commands"; groups: CommandGroup[] }
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
 * Commands that ran one after another in the same phase. Its phase is a piece of its own, which the filter leaves out
 * below its level, so the groups then show as one list.
 */
export interface CommandGroup {
  /** The part of a step that compares the host's state that ran the commands. Unset for a step that doesn't compare. */
  phase?: PieceLevels & { phase: ConvergePhase }
  commands: StepCommand[]
}

/**
 * A command a step ran, and its label when tsinfra wrote it, with any secret in its text masked. Its options' values
 * and what it printed are pieces of their own, which the filter leaves out below their level.
 */
export interface StepCommand {
  cmd: string
  label?: string
  /** The tool whose call ran the command. Unset for a step's own command and for tsinfra's. */
  toolName?: ToolName
  /** The options the tool call set. Unset when it set none, and for a command no tool call ran. */
  options?: StepOption[]
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
  // The host's saved state couldn't be cleared after every step ran, so the next apply shows the steps that changed as
  // `resume`.
  | { kind: "savedStateFailure" }

/** The phases of a step whose commands can explain why its state still differs after the fix. */
export type StillDiffersPhase = Extract<ConvergePhase, "fix" | "after">

/**
 * Returns a host's block, with every piece at every level, each with the level it shows from: an entry per finished
 * step, then the host's failure, if it failed. A host that recorded no entries and didn't fail gets "empty script"
 * instead, so it's clear the host ran.
 */
export const toHostBlock = (hostRecord: HostRecord, mode: Mode): HostBlock => {
  const { name, entries, failure } = hostRecord
  if (entries.length === 0 && !failure) return { name, kind: "noEntries" }

  const hostBlockEntries = toHostBlockEntries(hostRecord, mode)
  return { name, kind: "entries", entries: hostBlockEntries }
}
