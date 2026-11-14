import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Check } from "#session/handlers/ensure/check.ts"
import { checkSchema } from "#session/handlers/ensure/check.ts"
import { compareCheck, isRecord } from "#session/handlers/ensure/comparison/comparison.ts"
import type { Fix } from "#session/handlers/ensure/fix.ts"
import { fixSchema, toFixDifference } from "#session/handlers/ensure/fix.ts"
import { getHostCheckDetails } from "#session/handlers/ensure/host-check-details.ts"
import type { Want } from "#session/handlers/ensure/want.ts"
import { wantSchema } from "#session/handlers/ensure/want.ts"
import type { ChangeStepResult } from "#session/handlers/shared/shared.ts"
import { withChangeStepResult, runChange, validateInput } from "#session/handlers/shared/shared.ts"
import type { EnvOptions, HandlerOptions, NeedsOptions } from "#session/handlers/step-options/step-options.ts"
import { NO_NEEDS, needsOptionsSchema } from "#session/handlers/step-options/step-options.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

export type { Check } from "#session/handlers/ensure/check.ts"
export type { Want } from "#session/handlers/ensure/want.ts"
export type { EnsureComparisonValues } from "#session/handlers/ensure/comparison/comparison.ts"
export type { FixDifference } from "#session/handlers/ensure/fix.ts"

/** `T` ties a check function's return type, and a fix function's difference, to `want`. */
export interface EnsureOptions<T extends Want> extends NeedsOptions, EnvOptions {
  /**
   * The answer `check` gives when already right. `true` means a command exits 0, and `false` means it exits non-zero. A
   * string is compared to a command's stdout, with trailing newlines ignored on both sides. An array of strings is
   * compared to a command's lines as a set. An object of string keys and string values is compared to a function's
   * object by key.
   */
  want: T
  /**
   * A command, or a function given `read` that returns the value to compare. An object `want` takes only a function. It
   * also runs during `plan`, so it must not change what the script manages.
   */
  check: Check<T>
  /**
   * A command, or a function that runs several commands by calling `exec`. A function also gets what the check found,
   * as its `FixDifference`, except for a boolean `want`. It only runs in `apply`.
   */
  fix: Fix<T>
  /**
   * Runs the check again after the fix, and fails the step when it still fails. Defaults to true. Set it to false only
   * for a fix whose effect nothing in the run can make visible, like one that needs a reboot.
   */
  verify?: boolean
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const ensureOptionsSchema = type
  .declare<HandlerOptions<EnsureOptions<Want>>>()
  .type(needsOptionsSchema.merge({ want: wantSchema, check: checkSchema, fix: fixSchema, "verify?": "boolean" }))
  // Refuse a command check for an object `want` before it runs, because a command's output has no keys.
  .narrow(({ want, check }, ctx) => {
    if (typeof check === "string" && isRecord(want))
      return ctx.reject({ path: ["check"], expected: "a check function for an object want", actual: "a command" })
    return true
  })
  .pipe((options) => ({ verify: true, needs: NO_NEEDS, ...options }))

export const handleEnsure = async (
  ctx: StepContext<"ensure">,
  options: unknown,
): Promise<Result<HandlerReturn<ChangeStepResult<"ensure">>>> => {
  const { kind, shell, readTools, converge, recordOptions } = ctx

  const validOptions = validateInput(options, ensureOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const { want, check, fix, verify, needs } = validOptions
  recordOptions({ verify })

  const status = await converge({
    needs,
    getHostDetails: async () => getHostCheckDetails(shell, readTools, check),
    compare: (hostCheckDetails) => compareCheck(hostCheckDetails, want),
    fix: async (_hostDetails, comparison) => runChange(ctx, fix, toFixDifference(comparison)),
    verify,
  })

  return withChangeStepResult(ctx, status)
}
