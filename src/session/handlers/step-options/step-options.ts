import { type } from "arktype"

import { quoteNames } from "#utils.ts"

export type {
  FileAttributeOptions,
  FileOwner,
  MaskOptions,
  NeedsOptions,
  OwnerOptions,
  StepNeeds,
} from "#session/handlers/step-options/handler-options.ts"
export {
  fileAttributeOptionsSchema,
  maskOptionsSchema,
  needsOptionsSchema,
  NO_NEEDS,
  ownerOptionsSchema,
} from "#session/handlers/step-options/handler-options.ts"

/** The `sudo` option, which `callStep` handles itself, before a step's handler runs. */
export interface SudoOptions {
  /** Runs the step's commands as root, in `plan` as well as `apply`. */
  sudo?: boolean
}

export const sudoOptionsSchema = type.declare<SudoOptions>().type({ "sudo?": "boolean" })

/**
 * The variables a step's commands reference as `"$NAME"`, which `callStep` handles itself, before a step's handler
 * runs.
 */
export interface EnvOptions {
  /** Variables exported to every command the step runs, including its functions' tool calls. */
  env?: Record<string, string>
  /** Variables like `env`, whose values show as `[MASKED]` wherever they'd show, from this step on. */
  secretEnv?: Record<string, string>
}

// Require a valid shell name, because an invalid one turns its line of the prelude into a different command.
const SHELL_NAME_PATTERN = /^[A-Z_a-z]\w*$/v

// Check the names in a narrow, because ArkType's own message for a key that fails a pattern is "must be removed".
const envVariablesSchema = type("Record<string, string>").narrow((variables, ctx) => {
  const invalidNames = Object.keys(variables).filter((name) => !SHELL_NAME_PATTERN.test(name))
  return (
    invalidNames.length === 0
    || ctx.reject({
      expected: "valid shell names, of letters, digits, and underscores, not starting with a digit",
      actual: quoteNames(invalidNames),
    })
  )
})

// Refuse a name in both, because only one value can reach the command.
export const envOptionsSchema = type
  .declare<EnvOptions>()
  .type({ "env?": envVariablesSchema, "secretEnv?": envVariablesSchema })
  .narrow(({ env = {}, secretEnv = {} }, ctx) => {
    const sharedNames = Object.keys(env).filter((name) => Object.hasOwn(secretEnv, name))
    return (
      sharedNames.length === 0
      || ctx.reject({ expected: "names in only one of env and secretEnv", actual: quoteNames(sharedNames) })
    )
  })

/** The options that change how every command in a step runs, which `callStep` handles itself. */
export interface StepShellOptions extends SudoOptions, EnvOptions {}

// Check only the step's shell options, because a step's handler validates the rest, and ArkType ignores keys it doesn't
// name. Set the defaults in a pipe, because ArkType only allows a default on a required key.
export const stepShellOptionsSchema = type
  .declare<StepShellOptions>()
  .type(sudoOptionsSchema.and(envOptionsSchema))
  .pipe(({ sudo = false, env = {}, secretEnv = {} }) => ({ sudo, env, secretEnv }))

/** The shell options after validation, with their defaults set. */
export type ValidStepShellOptions = typeof stepShellOptionsSchema.infer

/** Removes the options `callStep` handles from `T`, leaving the ones a step's handler validates. */
export type HandlerOptions<T> = Omit<T, keyof StepShellOptions>
