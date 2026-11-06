import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { compareFile } from "#session/handlers/file/comparison.ts"
import { getContentDetails } from "#session/handlers/file/content-details.ts"
import type { FileMode } from "#session/handlers/file/mode.ts"
import { OCTAL_MODE_PATTERN, SYMBOLIC_MODE_PATTERN } from "#session/handlers/file/mode.ts"
import type { ChangeStepResult, StepNeeds } from "#session/handlers/shared/change-step-result.ts"
import { NO_NEEDS, stepNeedsSchema, withChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import { hostPathSchema, resolveHome } from "#session/handlers/shared/path.ts"
import { validateInput } from "#session/handlers/validate-input.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"

/**
 * What the file should hold: a string or bytes computed on the control machine, or a `Blob` like `Bun.file(...)` for a
 * file there.
 */
export type FileContent = string | Uint8Array | Blob

// Widen `Uint8Array` with `as`, because ArkType infers `Uint8Array<ArrayBuffer>` and `FileContent` takes any buffer.
const fileContentSchema = type
  .declare<FileContent>()
  .type(type("string").or(type.instanceOf(Uint8Array).as<Uint8Array>()).or(type.instanceOf(Blob)))

// Write the reason here, because ArkType's summary names different types depending on the value.
const INVALID_CONTENT_REASON = "must be a string, bytes, or a Blob"

const fileOwnerSchema = type("string | number")
export type FileOwner = typeof fileOwnerSchema.infer

/** What a file step manages besides its content. An existing file keeps its own value of any left out. */
export interface FileAttributes {
  /**
   * The file's mode, in octal like `"644"`, symbolic like `"rw-r--r--"`, or a constant like `PUBLIC_FILE_MODE`. An
   * existing file keeps its own when this is left out.
   */
  mode?: FileMode
  /** The user that owns the file: a name is compared with its name, and a number with its uid. */
  user?: FileOwner
  /** The group that owns the file: a name is compared with its name, and a number with its gid. */
  group?: FileOwner
}

export interface FileOptions extends FileAttributes {
  /** Never fetches or shows the old content, because it may hold a secret. */
  secret?: boolean
  /**
   * Earlier steps this step depends on. In `plan`, the step waits instead of reading the file when one of them would
   * change or is waiting.
   */
  needs?: StepNeeds
}

// Validate the options at runtime too, because a script can get past the types, like with `as` or `@ts-ignore`.
// Set the defaults in a pipe, because ArkType only allows a default on a required key.
const fileOptionsSchema = type
  .declare<FileOptions>()
  .type({
    "mode?": type(OCTAL_MODE_PATTERN).or(type(SYMBOLIC_MODE_PATTERN)),
    "user?": fileOwnerSchema,
    "group?": fileOwnerSchema,
    "secret?": "boolean",
    "needs?": stepNeedsSchema,
  })
  .pipe((options) => ({ secret: false, needs: NO_NEEDS, ...options }))

/** The options after validation, with their defaults set. */
export type ValidFileOptions = typeof fileOptionsSchema.infer

// oxlint-disable-next-line eslint/max-params - a handler takes its context, then each input the script gave the step
export const handleFile = async (
  ctx: StepContext<"file">,
  path: unknown,
  content: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<ChangeStepResult<"file">>>> => {
  const { kind, home, converge } = ctx

  const validPath = validateInput(path, hostPathSchema, { inputLabel: "path", givenTo: kind })
  if (isErr(validPath)) return validPath

  const absolutePath = resolveHome(validPath, home)
  if (isErr(absolutePath)) return absolutePath

  const validContent = validateInput(content, fileContentSchema, {
    inputLabel: "content",
    givenTo: kind,
    reason: INVALID_CONTENT_REASON,
  })
  if (isErr(validContent)) return validContent

  const validOptions = validateInput(options, fileOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const contentDetails = await getContentDetails(validContent)
  if (isErr(contentDetails)) return contentDetails

  const { needs } = validOptions

  const status = await converge({
    needs,
    compare: async () => compareFile(ctx, absolutePath, contentDetails, validOptions),
    // oxlint-disable-next-line typescript/require-await - the write comes with part 2 of `file`, and this stands in for it
    fix: async () => err("writing files comes with part 2 of file", undefined),
    verify: true,
  })

  return withChangeStepResult(ctx, status)
}
