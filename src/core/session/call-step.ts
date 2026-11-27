import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { SessionContext } from "#core/session.ts"
import { createStepNameClaims } from "#core/session/call-step/step-names.ts"
import type { StepShellOptions } from "#core/session/handlers/options/step.ts"
import { stepShellOptionsSchema } from "#core/session/handlers/options/step.ts"
import type { PathAttributeClaim } from "#core/session/handlers/shared/filesystem/attributes/claims.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import type { ChangeTools, Exec, GetToolShell, Inspect, ReadTools } from "#core/session/handlers/tools.ts"
import { execCommand, inspectCommand } from "#core/session/handlers/tools.ts"
import type { CallOrFail, ScriptBoundary } from "#core/session/script-boundary.ts"
import type { HandlerReturn, StepContext, StepKind } from "#core/session/step.ts"
import { nonEmptyStringSchema } from "#core/session/step.ts"
import type { Mode } from "#mode.ts"

// Name what each step takes as its name, so a validation error says which argument is wrong.
const STEP_NAME_LABELS: Record<StepKind, string> = {
  read: "command",
  inspect: "command",
  file: "path",
  link: "path",
  dir: "path",
  ensure: "name",
  run: "name",
}

/** Returns the tools a step's functions are given, running each call's command on its own shell from `getToolShell`. */
const createTools = (callOrFail: CallOrFail, getToolShell: GetToolShell) => {
  const readTool: Exec = async (cmd, options) =>
    callOrFail(async () => execCommand({ toolName: "read", getToolShell }, cmd, options))
  const inspectTool: Inspect = async (cmd, options) =>
    callOrFail(async () => inspectCommand({ toolName: "inspect", getToolShell }, cmd, options))
  const execTool: Exec = async (cmd, options) =>
    callOrFail(async () => execCommand({ toolName: "exec", getToolShell }, cmd, options))
  const readTools: ReadTools = { read: readTool, inspect: inspectTool }
  const changeTools: ChangeTools = { exec: execTool, inspect: inspectTool }
  return { readTools, changeTools }
}

/** Returns the function that runs each of one host's steps, with what the steps of its session share. */
export const createCallStep = (sessionContext: SessionContext, mode: Mode, scriptBoundary: ScriptBoundary) => {
  const { facts, savedStateManager, sessionRecorder } = sessionContext
  const { home } = facts
  const { getStepShells, recordOptions, startStep, finishStep, failStep, convergeRecorder } = sessionRecorder
  const { callOrFail } = scriptBoundary

  const claimStepName = createStepNameClaims(home)

  // Share these across the session's steps, because a step checks whether the steps it follows or needs changed.
  // A run also checks whether the steps it follows run on every pass, and a path step checks what earlier ones set.
  const changedStepNames = new Set<string>()
  const ranAlwaysStepNames = new Set<string>()
  const pathAttributeClaims = new Map<string, PathAttributeClaim[]>()

  /**
   * Runs one step: records it, runs `handler` with the step's context, and records how it turned out. Returns the value
   * the script gets, or throws the step's failure.
   */
  const callStep = async <K extends StepKind, T>(
    stepName: unknown,
    kind: K,
    handler: (ctx: StepContext<K>) => Promise<Result<HandlerReturn<T>>>,
    options: StepShellOptions = {},
  ): Promise<T> =>
    callOrFail(async () => {
      // Validate the name before recording the step, because the output shows every recorded step by its name.
      const validName = validateInput(stepName, nonEmptyStringSchema, {
        inputLabel: STEP_NAME_LABELS[kind],
        givenTo: kind,
      })
      if (isErr(validName)) return validName

      const stepStart = startStep(validName, kind)
      if (isErr(stepStart)) return stepStart

      const nameClaim = claimStepName(validName, kind)
      if (isErr(nameClaim)) {
        failStep(nameClaim)
        return nameClaim
      }

      // Validate `options` after recording the step, so a bad one fails under the step like the step's other inputs.
      const validOptions = validateInput(options, stepShellOptionsSchema, { inputLabel: "options", givenTo: kind })
      if (isErr(validOptions)) {
        failStep(validOptions)
        return validOptions
      }

      const { stepShell, getToolShell } = getStepShells(validOptions)
      const { readTools, changeTools } = createTools(callOrFail, getToolShell)

      const ctx: StepContext<K> = {
        stepName: validName,
        kind,
        mode,
        shell: stepShell,
        home,
        savedStateManager,
        changedStepNames,
        ranAlwaysStepNames,
        pathAttributeClaims,
        readTools,
        changeTools,
        convergeRecorder,
        recordOptions,
      }

      const handlerReturn = await handler(ctx)
      if (isErr(handlerReturn)) {
        failStep(handlerReturn)
        return handlerReturn
      }

      finishStep(handlerReturn.status)
      return handlerReturn.value
    })

  return callStep
}
