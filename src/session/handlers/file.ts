import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { isErr } from "ts-explicit-errors"

import { compareFile } from "#session/handlers/file/comparison.ts"
import type { HostFileDetails } from "#session/handlers/file/host-file-details.ts"
import { getHostFileDetails } from "#session/handlers/file/host-file-details.ts"
import { resolveContent } from "#session/handlers/file/resolved-content.ts"
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

export interface FileOptions extends FileAttributeOptions, SudoOptions, NeedsOptions {
  /** Never fetches or shows the old content, because it may hold a secret. */
  secret?: boolean
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const fileOptionsSchema = type
  .declare<HandlerOptions<FileOptions>>()
  .type(fileAttributeOptionsSchema.merge(needsOptionsSchema).merge({ "secret?": "boolean" }))
  .pipe((options) => ({ secret: false, needs: NO_NEEDS, ...options }))

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

  const { needs } = validOptions

  // Keep what `compare` read for `fix`, because a write keeps the mode and owner of a file it replaces.
  let hostFileDetails: HostFileDetails = { kind: "new", path: absolutePath }

  const status = await converge({
    needs,
    compare: async () => {
      const hostFileDetailsResult = await getHostFileDetails(shell, absolutePath)
      if (isErr(hostFileDetailsResult)) return hostFileDetailsResult

      hostFileDetails = hostFileDetailsResult
      return compareFile(ctx, hostFileDetails, resolvedContent, validOptions)
    },
    fix: async () => writeFile(ctx, hostFileDetails, resolvedContent, validOptions),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
