import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import { compareLink } from "#session/handlers/link/comparison.ts"
import { getHostLinkDetails } from "#session/handlers/link/host-link-details.ts"
import { writeLink } from "#session/handlers/link/write.ts"
import type { ChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import { withChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import type { OwnerOptions } from "#session/handlers/shared/filesystem/attributes.ts"
import { ownerOptionsSchema } from "#session/handlers/shared/filesystem/attributes.ts"
import { validateHostPath } from "#session/handlers/shared/filesystem/path.ts"
import type { NeedsOptions, SudoOptions } from "#session/handlers/shared/step-options.ts"
import { NO_NEEDS, needsOptionsSchema } from "#session/handlers/shared/step-options.ts"
import { validateInput } from "#session/handlers/shared/validate-input.ts"
import type { HandlerOptions, HandlerReturn, StepContext } from "#session/step.ts"

export interface LinkOptions extends OwnerOptions, SudoOptions, NeedsOptions {
  /** Replaces a regular file or an empty directory at the path. A directory with files in it is an error. */
  force?: boolean
}

// Write the reason here, because a relative target is a different mistake from a relative path.
const INVALID_TARGET_REASON =
  "must be an absolute path, like '/etc/...' or '~/...', because a relative target is resolved from the link's directory"

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const linkOptionsSchema = type
  .declare<HandlerOptions<LinkOptions>>()
  .type(ownerOptionsSchema.merge(needsOptionsSchema).merge({ "force?": "boolean" }))
  .pipe((options) => ({ force: false, needs: NO_NEEDS, ...options }))

/** The options after validation, with their defaults set. */
export type ValidLinkOptions = typeof linkOptionsSchema.infer

export const handleLink = async (
  ctx: StepContext<"link">,
  path: unknown,
  target: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<ChangeStepResult<"link">>>> => {
  const { kind, shell, home, converge } = ctx

  const absolutePath = validateHostPath(path, home, { inputLabel: "path", givenTo: kind })
  if (isErr(absolutePath)) return absolutePath

  const absoluteTarget = validateHostPath(target, home, {
    inputLabel: "target",
    givenTo: kind,
    reason: INVALID_TARGET_REASON,
  })
  if (isErr(absoluteTarget)) return absoluteTarget

  const validOptions = validateInput(options, linkOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const { needs } = validOptions

  const status = await converge({
    needs,
    getHostDetails: async () => getHostLinkDetails(shell, absolutePath, absoluteTarget),
    compare: async (hostLinkDetails) => compareLink(ctx, hostLinkDetails, absoluteTarget, validOptions),
    fix: async (hostLinkDetails) => writeLink(ctx, hostLinkDetails, absoluteTarget, validOptions),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
