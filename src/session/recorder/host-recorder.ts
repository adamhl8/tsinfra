import type { ValidHostOptions } from "#hosts/hosts.ts"
import { getPreparationFailureHints, getStepFailureHints } from "#session/recorder/failure-hints.ts"
import type { HostRecord, RecordedFailure, RecordedUnownedFailure, StepRecord } from "#session/recorder/records.ts"
import type { StepRecorder } from "#session/recorder/step-recorder.ts"
import { createStepRecorder } from "#session/recorder/step-recorder.ts"

export interface HostRecorder {
  hostRecord: HostRecord
  stepRecorder: StepRecorder
  /** Marks the host as no longer preparing. */
  finishPreparation: () => void
  /** Records `error` as the preparation's failure, with hints for it, and marks the host as no longer preparing. */
  failPreparation: (error: Error) => void
  /**
   * Keeps `error` as the host's failure, and returns the failure the host ends up with. A new failure is the
   * preparation's while the host is preparing, and the host function's after, until a step that was running makes it
   * its own when it finishes.
   */
  recordFailure: (error: Error) => RecordedFailure
}

/** Records one host's run, from preparation to the end of its host function, for the report to read. */
export const createHostRecorder = (name: string, target: string, hostOptions: ValidHostOptions): HostRecorder => {
  const hostRecord: HostRecord = { name, target, preparationCommands: [], stepRecords: [] }
  let isPreparing = true

  // Keep the first failure's error, because calls made at once with `Promise.all` can each fail.
  // Replace it only with an error that wraps it, which adds context such as the step's name.
  const keepError = (error: Error): Error => {
    const keptError = hostRecord.failure?.error
    return keptError === undefined || error.cause === keptError ? error : keptError
  }

  const recordFailure = (error: Error): RecordedFailure => {
    const { failure } = hostRecord
    // Keep an existing failure's kind, and only update its error, because the failure is already where it came from.
    // `callOrFail` records again the error a step's failure already holds, and calls made at once can each fail.
    if (failure) {
      failure.error = keepError(error)
      return failure
    }

    const newFailure: RecordedUnownedFailure = { kind: isPreparing ? "preparation" : "host fn", error, hints: [] }
    hostRecord.failure = newFailure
    return newFailure
  }

  // Work out the hints when the step is done, from all of its commands.
  const recordStepFailure = (stepRecord: StepRecord, error: Error) => {
    const hints = getStepFailureHints(hostOptions, stepRecord.commands)
    hostRecord.failure = { kind: "step", stepRecord, error: keepError(error), hints }
  }

  const finishPreparation = () => {
    isPreparing = false
  }

  // Record the failure before finishing, so `recordFailure` still gives it the `preparation` kind.
  const failPreparation = (error: Error) => {
    const failure = recordFailure(error)
    failure.hints = getPreparationFailureHints(target, failure.error)
    finishPreparation()
  }

  const stepRecorder = createStepRecorder({ hostRecord, recordStepFailure })

  return { hostRecord, stepRecorder, finishPreparation, failPreparation, recordFailure }
}
