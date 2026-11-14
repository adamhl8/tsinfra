import { type } from "arktype"

import type { RecordWant } from "#session/handlers/ensure/comparison/comparison.ts"
import type { Want } from "#session/handlers/ensure/want.ts"
import type { ReadTools } from "#session/handlers/tools.ts"
import { nonEmptyStringSchema } from "#session/step.ts"

type CheckFunction<T> = (tools: ReadTools) => Promise<T>

/**
 * A step's check: a command, or a function given `ReadTools` that returns the value to compare. An object `want` takes
 * only a function, because a command's output has no keys. Checks `[T]` so it doesn't split a union `T`.
 */
export type Check<T> = [T] extends [RecordWant] ? CheckFunction<T> : string | CheckFunction<T>

// Type the function as a `CheckFunction`, because only "is a function" can be validated at runtime.
export const checkSchema = type
  .declare<Check<Want>>()
  .type(nonEmptyStringSchema.or(type("Function").as<CheckFunction<Want>>()))
