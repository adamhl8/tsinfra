import type { EnsureOptions } from "#core/session/handlers/ensure.ts"
import type { Want } from "#core/session/handlers/ensure/want.ts"
import type { FileOptions } from "#core/session/handlers/file.ts"
import type { LinkOptions } from "#core/session/handlers/link.ts"
import type { InputOptions, MaskOptions } from "#core/session/handlers/options/command.ts"
import type { StepShellOptions } from "#core/session/handlers/options/step.ts"

const NO_VARIABLES: Record<string, string> = {}

/**
 * The defaults of the options a step's or a tool call's record holds, so the recorder leaves out any option still at
 * its default. Each schema declares its own defaults, and the tests that record a step with no options catch any
 * default that differs. Check it against `RecordableOptions`, so an option added, removed, or retyped there fails to
 * compile here. Leave out `validate` and `input`, because they have no default.
 */
export const RECORDED_OPTION_DEFAULTS = {
  sudo: false,
  env: NO_VARIABLES,
  secretEnv: NO_VARIABLES,
  secret: false,
  overwrite: true,
  force: false,
  verify: true,
  maskOutput: false,
} satisfies Required<Omit<RecordableOptions, "validate" | "input">>

/**
 * Every option a step's or a tool call's record can hold, as the handler or the tool gives it: the shell options, then
 * the step's own options that the report shows. A tool call's are the ones `ToolOptions` names.
 */
interface RecordableOptions
  extends
    StepShellOptions,
    Pick<FileOptions, "secret" | "overwrite">,
    Pick<LinkOptions, "force">,
    Pick<EnsureOptions<Want>, "verify">,
    InputOptions,
    MaskOptions {
  /** `validate`'s command, which the handler builds from the function the script passed. */
  validate?: string
}

/**
 * What the record holds in place of each option it never holds as given, like `input`, which may be a secret, and can
 * be large. Any other option is recorded as given.
 */
export const RECORDED_STAND_INS = { input: "<content>" } as const satisfies {
  [K in keyof RecordableOptions]?: string
}

/** What `recordOptions` takes. Each option can be unset, and the recorder leaves out what's unset. */
export type StepOptionsToRecord = { [K in keyof RecordableOptions]?: RecordableOptions[K] | undefined }

/** The options a step's record holds: each one as given, or its stand-in. */
export type StepOptionsRecord = {
  [K in keyof RecordableOptions]: K extends keyof typeof RECORDED_STAND_INS
    ? (typeof RECORDED_STAND_INS)[K]
    : RecordableOptions[K]
}
