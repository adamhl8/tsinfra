import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Check, Want } from "#session/handlers/ensure/check.ts"
import { checkSchema, wantSchema } from "#session/handlers/ensure/check.ts"
import { compareCheck } from "#session/handlers/ensure/comparison.ts"
import { getHostCheckDetails } from "#session/handlers/ensure/host-check-details.ts"
import type { ChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import { withChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import type { Change } from "#session/handlers/shared/change.ts"
import { changeSchema, runChange } from "#session/handlers/shared/change.ts"
import type { NeedsOptions } from "#session/handlers/shared/step-options.ts"
import { NO_NEEDS, needsOptionsSchema } from "#session/handlers/shared/step-options.ts"
import { validateInput } from "#session/handlers/shared/validate-input.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

/** `T` ties a check function's return type to `want`, so a boolean check can't be compared to a string. */
export interface EnsureOptions<T extends Want> extends NeedsOptions {
  /**
   * A command, or a function given `read` that returns the value to compare. It also runs during `plan`, so it must not
   * change what the script manages.
   */
  check: Check<T>
  /**
   * The answer `check` gives when already right. `true` means a command exits 0, and `false` means it exits non-zero. A
   * string is compared to a command's stdout. Trailing newlines are ignored on both sides.
   */
  want: T
  /** A command, or a function that runs several commands by calling `exec`. It only runs in `apply`. */
  fix: Change
  /**
   * Runs the check again after the fix, and fails the step when it still fails. Defaults to true. Set it to false only
   * for a fix whose effect nothing in the run can make visible, like one that needs a reboot.
   */
  verify?: boolean
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const ensureOptionsSchema = type
  .declare<EnsureOptions<Want>>()
  .type(needsOptionsSchema.merge({ check: checkSchema, want: wantSchema, fix: changeSchema, "verify?": "boolean" }))
  .pipe((options) => ({ verify: true, needs: NO_NEEDS, ...options }))

export const handleEnsure = async (
  ctx: StepContext<"ensure">,
  options: unknown,
): Promise<Result<HandlerReturn<ChangeStepResult<"ensure">>>> => {
  const { kind, shell, readTools, converge } = ctx

  const validOptions = validateInput(options, ensureOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const { check, want, fix, verify, needs } = validOptions

  const status = await converge({
    needs,
    getHostDetails: async () => getHostCheckDetails(shell, readTools, check),
    compare: (hostCheckDetails) => compareCheck(hostCheckDetails, want),
    fix: async () => runChange(ctx, fix),
    verify,
  })

  return withChangeStepResult(ctx, status)
}
