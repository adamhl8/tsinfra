import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import { compareFile } from "#core/session/handlers/file/comparison.ts"
import { getHostFileDetails } from "#core/session/handlers/file/host-file-details.ts"
import { resolveContent } from "#core/session/handlers/file/resolved-content.ts"
import { buildValidateCommand } from "#core/session/handlers/file/validate-command.ts"
import type { FileWrite } from "#core/session/handlers/file/write.ts"
import { writeFile } from "#core/session/handlers/file/write.ts"
import type { FileAttributeOptions, NeedsOptions } from "#core/session/handlers/options/handler.ts"
import { fileAttributeOptionsSchema, NO_NEEDS, needsOptionsSchema } from "#core/session/handlers/options/handler.ts"
import type { HandlerOptions, SudoOptions } from "#core/session/handlers/options/shell.ts"
import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { withChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import type { Content } from "#core/session/handlers/shared/content.ts"
import { contentSchema, INVALID_CONTENT_REASON } from "#core/session/handlers/shared/content.ts"
import { converge } from "#core/session/handlers/shared/converge.ts"
import { claimPathAttributes } from "#core/session/handlers/shared/filesystem/attributes/claims.ts"
import { validateHostPath } from "#core/session/handlers/shared/filesystem/path.ts"
import { validateInput } from "#core/session/handlers/shared/validate-input.ts"
import type { HandlerReturn, StepContext } from "#core/session/step.ts"

/**
 * What the file should hold: a string or bytes computed on the control machine, or a `Blob` like `bun.file(...)` for a
 * file there.
 */
export type FileContent = Content

/** Returns a command that checks the new content, given the temp file's path already quoted for the shell. */
export type ValidateFunction = (tempPath: string) => string

export interface FileOptions extends FileAttributeOptions, SudoOptions, NeedsOptions {
  /** Never fetches or shows the old content, because it may hold a secret. */
  secret?: boolean
  /**
   * Writes the file only when it's missing. `false` leaves an existing file alone, its mode and owner included, because
   * an app that rewrites its own file sets those too.
   */
  overwrite?: boolean
  /**
   * Checks the new content before it replaces the file, with a command run against the temp file, like `sshd -t -f`. A
   * non-zero exit fails the step and leaves the old file as it was. It runs only in `apply`, as the write does.
   */
  validate?: ValidateFunction
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const fileOptionsSchema = type
  .declare<HandlerOptions<FileOptions>>()
  .type(
    fileAttributeOptionsSchema.merge(needsOptionsSchema).merge({
      "secret?": "boolean",
      "overwrite?": "boolean",
      "validate?": type("Function").as<ValidateFunction>(),
    }),
  )
  .pipe((options) => ({ secret: false, overwrite: true, needs: NO_NEEDS, ...options }))

/** The options after validation, with their defaults set. */
export type ValidFileOptions = typeof fileOptionsSchema.infer

export const handleFile = async (
  ctx: StepContext<"file">,
  path: unknown,
  content: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<ChangeStepResult<"file">>>> => {
  const { kind, shell, home, recordOptions } = ctx

  const absolutePath = validateHostPath(path, home, { inputLabel: "path", givenTo: kind })
  if (isErr(absolutePath)) return absolutePath

  const validContent = validateInput(content, contentSchema, {
    inputLabel: "content",
    givenTo: kind,
    reason: INVALID_CONTENT_REASON,
  })
  if (isErr(validContent)) return validContent

  const validOptions = validateInput(options, fileOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const resolvedContent = await resolveContent(validContent)
  if (isErr(resolvedContent)) return resolvedContent

  const { needs, validate, secret, overwrite } = validOptions

  const validateCommand = buildValidateCommand(validate)
  if (isErr(validateCommand)) return validateCommand

  // Record `validate` as the command it built, because the script passed a function.
  recordOptions({ validate: validateCommand, secret, overwrite })

  // Claim the file's attributes before `converge`, so a conflict fails in `plan` too, even for a step that waits.
  const attributeClaimResult = claimPathAttributes(ctx, absolutePath, validOptions)
  if (isErr(attributeClaimResult)) return attributeClaimResult

  const fileWrite: FileWrite = { resolvedContent, validateCommand }

  const status = await converge(ctx, {
    needs,
    getHostDetails: async () => getHostFileDetails(shell, absolutePath),
    compare: async (hostFileDetails) => compareFile(ctx, hostFileDetails, resolvedContent, validOptions),
    fix: async (hostFileDetails) => writeFile(ctx, hostFileDetails, fileWrite, validOptions),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
