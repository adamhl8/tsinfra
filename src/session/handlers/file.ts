import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import { compareFile } from "#session/handlers/file/comparison.ts"
import { getHostFileDetails } from "#session/handlers/file/host-file-details.ts"
import { resolveContent } from "#session/handlers/file/resolved-content.ts"
import { buildValidateCommand } from "#session/handlers/file/validate-command.ts"
import type { FileWrite } from "#session/handlers/file/write.ts"
import { writeFile } from "#session/handlers/file/write.ts"
import type { ChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import { withChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import type { FileAttributeOptions } from "#session/handlers/shared/filesystem/attributes.ts"
import { fileAttributeOptionsSchema } from "#session/handlers/shared/filesystem/attributes.ts"
import { validateHostPath } from "#session/handlers/shared/filesystem/path.ts"
import type { NeedsOptions, SudoOptions } from "#session/handlers/shared/step-options.ts"
import { NO_NEEDS, needsOptionsSchema } from "#session/handlers/shared/step-options.ts"
import { validateInput } from "#session/handlers/shared/validate-input.ts"
import type { HandlerOptions, HandlerReturn, StepContext } from "#session/step.ts"

/**
 * What the file should hold: a string or bytes computed on the control machine, or a `Blob` like `bun.file(...)` for a
 * file there.
 */
export type FileContent = string | Uint8Array | Blob

// Widen `Uint8Array` with `as`, because ArkType infers `Uint8Array<ArrayBuffer>` and `FileContent` takes any buffer.
const fileContentSchema = type
  .declare<FileContent>()
  .type(type("string").or(type.instanceOf(Uint8Array).as<Uint8Array>()).or(type.instanceOf(Blob)))

// Write the reason here, because ArkType's summary names different types depending on the value.
const INVALID_CONTENT_REASON = "must be a string, bytes, or a Blob"

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
  const { kind, shell, home, converge } = ctx

  const absolutePath = validateHostPath(path, home, { inputLabel: "path", givenTo: kind })
  if (isErr(absolutePath)) return absolutePath

  const validContent = validateInput(content, fileContentSchema, {
    inputLabel: "content",
    givenTo: kind,
    reason: INVALID_CONTENT_REASON,
  })
  if (isErr(validContent)) return validContent

  const validOptions = validateInput(options, fileOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const resolvedContent = await resolveContent(validContent)
  if (isErr(resolvedContent)) return resolvedContent

  const { needs, validate } = validOptions

  const validateCommand = buildValidateCommand(validate)
  if (isErr(validateCommand)) return validateCommand

  const fileWrite: FileWrite = { resolvedContent, validateCommand }

  const status = await converge({
    needs,
    getHostDetails: async () => getHostFileDetails(shell, absolutePath),
    compare: async (hostFileDetails) => compareFile(ctx, hostFileDetails, resolvedContent, validOptions),
    fix: async (hostFileDetails) => writeFile(ctx, hostFileDetails, fileWrite, validOptions),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
