import { type } from "arktype"

import type { ReadTools } from "#session/handlers/tools.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

type CheckFunction<T> = (tools: ReadTools) => Promise<T>

/** A step's check: a command, or a function given `ReadTools` that returns the value to compare. */
export type Check<T> = string | CheckFunction<T>

// Type the function as a `CheckFunction`, because only "is a function" can be validated at runtime.
export const checkSchema = type
  .declare<Check<Want>>()
  .type(nonEmptyStringSchema.or(type("Function").as<CheckFunction<Want>>()))

/** What a step wants: an exit status as a boolean, a string to match, or a list of strings to match as a set. */
export type Want = boolean | string | readonly string[]

// Type the list as readonly, so a script can pass a constant or an `as const` array, which the schema can't express.
// Word the problem, because ArkType's own calls the array "an object".
export const wantSchema = type("boolean | string | string[]")
  .configure({ problem: (ctx) => `must be a boolean, a string, or an array of strings (was ${ctx.actual})` })
  .as<Want>()
