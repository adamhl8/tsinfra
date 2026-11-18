import { type } from "arktype"

import type { ChangeStepResult } from "#core/session/handlers/shared/change-step-result.ts"
import { changeStepResultSchema } from "#core/session/handlers/shared/change-step-result.ts"
import type { Content } from "#core/session/handlers/shared/content.ts"
import { CONTENT_DESCRIPTION, contentSchema } from "#core/session/handlers/shared/content.ts"
import type { FileMode } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import { OCTAL_MODE_PATTERN, SYMBOLIC_MODE_PATTERN } from "#core/session/handlers/shared/filesystem/attributes/mode.ts"
import type { ChangeStepKind } from "#core/session/step.ts"

/** The `input` option, for a command that reads data on its stdin. */
export interface InputOptions {
  /** Sends this to the command's stdin: a string, bytes, or a `Blob` like `bun.file(...)`, up to 10 MB. */
  input?: Content
}

// Check `input` in a narrow, because ArkType's summary for `contentSchema` names different types depending on the value.
const inputSchema = type("unknown")
  .narrow((value, ctx) => contentSchema.allows(value) || ctx.reject({ expected: CONTENT_DESCRIPTION }))
  .as<Content>()

export const inputOptionsSchema = type.declare<InputOptions>().type({ "input?": inputSchema })

/** The `maskOutput` option, for a command whose output is a secret. */
export interface MaskOptions {
  /** Masks the command's output like a secret, here and in every later command on the host. */
  maskOutput?: boolean
}

export const maskOptionsSchema = type.declare<MaskOptions>().type({ "maskOutput?": "boolean" })

// Accept only steps that read the host's state in `needs`, so not a run.
const NEEDABLE_STEP_KINDS = ["file", "link", "dir", "ensure"] as const satisfies ChangeStepKind[]
type NeedableStepKind = (typeof NEEDABLE_STEP_KINDS)[number]
/** The earlier steps a step depends on. */
export type StepNeeds = ChangeStepResult<NeedableStepKind>[]

/** The `needs` of a step that gives none. */
export const NO_NEEDS: StepNeeds = []

const stepNeedsSchema = type
  .declare<StepNeeds>()
  .type(changeStepResultSchema.and({ kind: type.enumerated(...NEEDABLE_STEP_KINDS) }).array())

/** The `needs` option, for a step that reads the host's state. */
export interface NeedsOptions {
  /**
   * Earlier steps this step depends on. In `plan`, the step waits instead of reading the host when one of them would
   * change or is waiting. A run's result can't be needed, so need the step that triggered the run instead.
   */
  needs?: StepNeeds
}

export const needsOptionsSchema = type.declare<NeedsOptions>().type({ "needs?": stepNeedsSchema })

const fileOwnerSchema = type("string | number")
export type FileOwner = typeof fileOwnerSchema.infer

/** Who should own what a step writes. Something already there keeps its own value of any left out. */
export interface OwnerOptions {
  /** The user that owns it: a name is compared with its name, and a number with its uid. */
  user?: FileOwner
  /** The group that owns it: a name is compared with its name, and a number with its gid. */
  group?: FileOwner
}

/** The owner options every step that writes something takes, for its options schema to merge. */
export const ownerOptionsSchema = type
  .declare<OwnerOptions>()
  .type({ "user?": fileOwnerSchema, "group?": fileOwnerSchema })

/** What a file step manages besides its content. An existing file keeps its own value of any left out. */
export interface FileAttributeOptions extends OwnerOptions {
  /**
   * The file's mode, in octal like `"644"`, symbolic like `"rw-r--r--"`, or a constant like `PUBLIC_FILE_MODE`. An
   * existing file keeps its own when this is left out.
   */
  mode?: FileMode
}

const fileModeSchema = type(OCTAL_MODE_PATTERN).or(type(SYMBOLIC_MODE_PATTERN))

export const fileAttributeOptionsSchema = type
  .declare<FileAttributeOptions>()
  .type(ownerOptionsSchema.merge({ "mode?": fileModeSchema }))
