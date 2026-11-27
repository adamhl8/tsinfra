import type { HostFacts } from "#core/hosts/prepare/host-details/facts.ts"
import type { HostMeta } from "#core/hosts/prepare/host-meta.ts"
import type { SessionRecorder, StepRecorder } from "#core/recorder/session-recorder.ts"
import type { SavedStateManager } from "#core/saved-state.ts"
import type { PathAttributeClaim } from "#core/session/handlers/shared/filesystem/attributes/claims.ts"
import type { ChangeTools, ReadTools } from "#core/session/handlers/tools.ts"
import type { StepKind } from "#core/session/step.ts"
import type { Shell } from "#core/transport/shell.ts"
import type { Mode } from "#mode.ts"

/**
 * What a step's handler is given: what's built for the step, and what every step of the session shares. `K` keeps a
 * step's kind in its type, so a script can't give a run's result to `needs`.
 */
export interface HandlerContext<K extends StepKind = StepKind> {
  step: StepContext<K>
  session: SessionContext
}

/** What's built for each step, from its name, its kind, and its options. */
interface StepContext<K extends StepKind = StepKind> {
  name: string
  kind: K
  shell: Shell
  tools: StepTools
}

/** The tools a step's functions are given, which run their commands on the step's own shells. */
interface StepTools {
  /** Given to a check function. */
  readTools: ReadTools
  /** Given to a fix or run function. */
  changeTools: ChangeTools
}

/** What every step of a host's session shares, built once for the session. */
export interface SessionContext {
  mode: Mode
  /** What preparation read from the host, like the SSH user's home directory. */
  facts: HostFacts
  /**
   * The host's saved state, which says whether a step's change is still open, and which a follow-up opens its own
   * change in and records itself on.
   */
  savedStateManager: SavedStateManager
  /** The part of the session recorder a step's code records through. */
  recorder: StepRecorder
  stepHistory: StepHistory
}

/** What the session has noted about its steps so far, which a later step checks. */
interface StepHistory {
  /**
   * The names of the change steps that changed in this pass. A result's `changed` is the script's value instead, which
   * a change still open from an earlier apply also makes true.
   */
  changedNames: Set<string>
  /** The names of the runs in `changedNames` that run on every pass, so a run that follows only them does too. */
  ranAlwaysNames: Set<string>
  /**
   * The claims steps made on each path's attributes, by its resolved path, so two steps can't set one differently. A
   * file's and a directory's are under their own path, and a link's `targetAttributes` are under its target.
   */
  pathAttributeClaims: Map<string, PathAttributeClaim[]>
}

/** What preparation gives a host's session, set up before any script runs. */
export interface SessionSetup {
  meta: HostMeta
  facts: HostFacts
  /** The host's saved state, read when it was prepared. */
  savedStateManager: SavedStateManager
  sessionRecorder: SessionRecorder
}
