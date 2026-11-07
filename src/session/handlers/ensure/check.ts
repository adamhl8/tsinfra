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

export const wantSchema = type("string | boolean")
export type Want = typeof wantSchema.infer
