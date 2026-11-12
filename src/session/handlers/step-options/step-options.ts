import { type } from "arktype"

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
  needsOptionsSchema,
  NO_NEEDS,
  ownerOptionsSchema,
} from "#session/handlers/step-options/handler-options.ts"

/** The `sudo` option, which `callStep` handles itself, before a step's handler runs. */
export interface SudoOptions {
  /** Runs the step's commands as root, in `plan` as well as `apply`. */
  sudo?: boolean
}

// Check only `sudo`, because a step's handler validates the rest of its options, and ArkType ignores keys it doesn't name.
// Set the default in a pipe, because ArkType only allows a default on a required key.
export const sudoOptionsSchema = type
  .declare<SudoOptions>()
  .type({ "sudo?": "boolean" })
  .pipe((options) => ({ sudo: false, ...options }))

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

/** Every option `callStep` handles itself, so `HandlerOptions` leaves out any added here. */
interface StepOptions extends SudoOptions, EnvOptions {}

/** Removes the options `callStep` handles from `T`, leaving the ones a step's handler validates. */
export type HandlerOptions<T> = Omit<T, keyof StepOptions>
