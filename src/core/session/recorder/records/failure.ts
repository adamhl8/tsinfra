import type { FailureHint } from "#core/session/recorder/failure-hints.ts"
import type { StepRecord } from "#core/session/recorder/records/step.ts"

/** A host's failure: one that no step owns, or a step's. */
export type RecordedFailure = RecordedUnownedFailure | RecordedStepFailure

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

interface BaseRecordedFailure {
  error: Error
  /** How to fix the failure, which the report shows under it. */
  hints: FailureHint[]
}
