import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import type { Check } from "#core/session/handlers/ensure/check.ts"
import { checkSchema } from "#core/session/handlers/ensure/check.ts"
import { compareCheck, getWantKind } from "#core/session/handlers/ensure/comparison.ts"
import type { Fix } from "#core/session/handlers/ensure/fix.ts"
import { fixSchema, toFixDifference } from "#core/session/handlers/ensure/fix.ts"
import { getHostCheckDetails } from "#core/session/handlers/ensure/host-check-details.ts"
import type { Want } from "#core/session/handlers/ensure/want.ts"
import { tagWant, wantSchema } from "#core/session/handlers/ensure/want.ts"
import type { NeedsOptions } from "#core/session/handlers/options/handler.ts"
import { NO_NEEDS, needsOptionsSchema } from "#core/session/handlers/options/handler.ts"
import type { EnvOptions, HandlerOptions } from "#core/session/handlers/options/shell.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { withChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { runChange } from "#core/session/handlers/shared/change.ts"
import { converge } from "#core/session/handlers/shared/converge.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import type { HandlerReturn, StepContext } from "#core/session/step.ts"

// Re-export the record comparison for `dir`, which is built on it, so its rows render as a record `want`'s.

/** `T` ties a check function's return type, and a fix function's difference, to `want`. */
export interface EnsureOptions<T extends Want> extends NeedsOptions, EnvOptions {
  /**
   * The answer `check` gives when already right. `true` means a command exits 0, and `false` means it exits non-zero. A
   * string is compared to a command's stdout, with trailing newlines ignored on both sides. A list, an array of
   * strings, is compared to a command's lines as a set. A set, a `Set` of strings, is compared the same way, and a
   * check function returns a `Set` for it. A record, an object of string keys and string, number, or boolean values, is
   * compared to a function's object by key, each value exactly, so a number never matches a string.
   */
  want: T
  /**
   * A command, or a function given `read` that returns the value to compare. A record `want` takes only a function. It
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
// Tag `want` with its kind in the same pipe, so later code switches on it instead of working the kind out again.
const ensureOptionsSchema = type
  .declare<HandlerOptions<EnsureOptions<Want>>>()
  .type(needsOptionsSchema.merge({ want: wantSchema, check: checkSchema, fix: fixSchema, "verify?": "boolean" }))
  // Refuse a command check for a record `want` before it runs, because a command's output has no keys.
  .narrow(({ want, check }, ctx) => {
    const isCommandForRecord = typeof check === "string" && getWantKind(want) === "record"
    if (isCommandForRecord)
      return ctx.reject({ path: ["check"], expected: "a check function for a record want", actual: "a command" })
    return true
  })
  .pipe((options) => ({ verify: true, needs: NO_NEEDS, ...options, want: tagWant(options.want) }))

export const handleEnsure = async (
  ctx: StepContext<"ensure">,
  options: unknown,
): Promise<Result<HandlerReturn<ChangeStepResult<"ensure">>>> => {
  const { kind, shell, readTools, recordOptions } = ctx

  const validOptions = validateInput(options, ensureOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const { want, check, fix, verify, needs } = validOptions
  recordOptions({ verify })

  const status = await converge(ctx, {
    needs,
    getHostDetails: async () => getHostCheckDetails(shell, readTools, check),
    compare: (hostCheckDetails) => compareCheck(hostCheckDetails, want),
    fix: async (_hostDetails, comparison) => runChange(ctx, fix, toFixDifference(comparison)),
    verify,
  })

  return withChangeStepResult(ctx, status)
}
