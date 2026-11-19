import { type } from "arktype"

import type { Content } from "#core/content.ts"
import { CONTENT_DESCRIPTION, contentSchema } from "#core/content.ts"
import { quoteNames } from "#utils.ts"

/** The `sudo` option, which `callStep` handles itself, before a step's handler runs. */
export interface SudoOptions {
  /** Runs the step's commands as root, in `plan` as well as `apply`. */
  sudo?: boolean
}

export const sudoOptionsSchema = type.declare<SudoOptions>().type({ "sudo?": "boolean" })

/** The variables a command references as `"$NAME"`, set on a step for all its commands, or on one tool call. */
export interface EnvOptions {
  /**
   * Variables exported to the commands: on a step, every command it runs, including its functions' tool calls, and on a
   * tool call, its one command, where they win over the step's.
   */
  env?: Record<string, string>
  /** Variables like `env`, whose values show as `[MASKED]` wherever they'd show, from this step or tool call on. */
  secretEnv?: Record<string, string>
}

// Require a valid variable name, because an invalid one turns its line of the prelude into a different command.
const VAR_NAME_PATTERN = /^[A-Z_a-z]\w*$/v

// Check the names in a narrow, because ArkType's own message for a key that fails a pattern is "must be removed".
const envVariablesSchema = type("Record<string, string>").narrow((variables, ctx) => {
  const invalidNames = Object.keys(variables).filter((name) => !VAR_NAME_PATTERN.test(name))
  return (
    invalidNames.length === 0
    || ctx.reject({
      expected: "valid variable names, of letters, digits, and underscores, not starting with a digit",
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
