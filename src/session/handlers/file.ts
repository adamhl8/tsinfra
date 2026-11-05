import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import { compareFile } from "#session/handlers/file/comparison.ts"
import type { FileMode } from "#session/handlers/file/mode.ts"
import { OCTAL_MODE_PATTERN, SYMBOLIC_MODE_PATTERN } from "#session/handlers/file/mode.ts"
import { toAbsolutePath } from "#session/handlers/file/path.ts"
import { toWantedFile } from "#session/handlers/file/wanted-file.ts"
import type { ChangeStepResult, StepNeeds } from "#session/handlers/shared/change-step-result.ts"
import { NO_NEEDS, stepNeedsSchema, withChangeStepResult } from "#session/handlers/shared/change-step-result.ts"
import { converge } from "#session/handlers/shared/converge.ts"
import { validateInput } from "#session/handlers/validate-input.ts"
import type { HandlerReturn, StepContext } from "#session/step.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

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

export interface FileOptions {
  /**
   * The file's mode, in octal like `"644"`, symbolic like `"rw-r--r--"`, or a constant like `PUBLIC_FILE_MODE`. An
   * existing file keeps its own when this is left out.
   */
  mode?: FileMode
  /** The user that owns the file: a name is compared with its name, and a number with its uid. */
  user?: FileOwner
  /** The group that owns the file: a name is compared with its name, and a number with its gid. */
  group?: FileOwner
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

// oxlint-disable-next-line eslint/max-params - a handler takes its context, then each input the script gave the step
export const handleFile = async (
  ctx: StepContext<"file">,
  path: unknown,
  content: unknown,
  options: unknown = {},
): Promise<Result<HandlerReturn<ChangeStepResult<"file">>>> => {
  const { kind, home } = ctx

  const validPath = validateInput(path, nonEmptyStringSchema, { inputLabel: "path", givenTo: kind })
  if (isErr(validPath)) return validPath

  const validContent = validateInput(content, fileContentSchema, {
    inputLabel: "content",
    givenTo: kind,
    reason: INVALID_CONTENT_REASON,
  })
  if (isErr(validContent)) return validContent

  const validOptions = validateInput(options, fileOptionsSchema, { inputLabel: "options", givenTo: kind })
  if (isErr(validOptions)) return validOptions

  const absolutePath = toAbsolutePath(validPath, home)
  if (isErr(absolutePath)) return absolutePath

  const wantedFile = await toWantedFile(validContent, validOptions)
  if (isErr(wantedFile)) return wantedFile

  const { secret, needs } = validOptions

  const outcome = await converge(ctx, {
    needs,
    compare: async () => compareFile(ctx, absolutePath, wantedFile, { secret }),
    // oxlint-disable-next-line typescript/require-await - the write comes with part 2 of `file`, and this stands in for it
    fix: async () => err("writing files comes with part 2 of file", undefined),
    verify: true,
  })

  return withChangeStepResult(ctx, outcome)
}
