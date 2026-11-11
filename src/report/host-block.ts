import type {
  EnsureComparisonValues,
  FileComparisonValues,
  LinkComparisonValues,
  RecordedUnownedFailure,
  StepKind,
  StepStatus,
} from "#session/session.ts"

/** A host's block: its name, then its entries, or "no steps" for a script that made none and didn't fail. */
export type HostBlock = { name: string } & ({ kind: "entries"; entries: HostBlockEntry[] } | { kind: "noSteps" })

/** One entry of a host block: a step, or the one failure no step owns. */
export interface HostBlockEntry {
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
export interface NotePart {
  kind: "needs"
  needs: string[]
}

/** One thing an entry shows under its status line. */
export type Detail =
  | { kind: "diff"; got: string; want: string }
  // Holds everything about a file but a text diff, which is a detail of its own.
  | { kind: "fileComparisonValues"; values: FileComparisonValues }
  | { kind: "linkComparisonValues"; values: LinkComparisonValues }
  | { kind: "ensureComparisonValues"; values: EnsureComparisonValues }
  // The stderr of a command that can explain a failure that still differs after its fix.
  | { kind: "stderr"; command: string; stderr: string }
  // tsinfra's own aside about the details around it.
  | { kind: "note"; text: string }
  // Something that worked, but needs a look, like a link to a path where nothing exists.
  | { kind: "warning"; warning: StepWarning }
  // How to fix a failure, like setting the host's `sudo` option.
  | { kind: "hint"; text: string }

/** Something that worked but needs a look, with the value it's about, like a path, when there is one. */
export interface StepWarning {
  text: string
  value?: string
}
