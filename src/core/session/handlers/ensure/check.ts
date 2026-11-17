import { type } from "arktype"

import type { RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import type { Want } from "#core/session/handlers/ensure/want.ts"
import type { ReadTools } from "#core/session/handlers/tools.ts"
import { nonEmptyStringSchema } from "#core/session/step.ts"

type CheckFunction<T> = (tools: ReadTools) => Promise<T>

/**
 * A step's check: a command, or a function given `ReadTools` that returns the value to compare. A record `want` takes
 * only a function, because a command's output has no keys. Checks `[T]` so it doesn't split a union `T`.
 */
export type Check<T> = [T] extends [RecordWant] ? CheckFunction<T> : string | CheckFunction<T>

// Type the function as a `CheckFunction`, because only "is a function" can be validated at runtime.
export const checkSchema = type
  .declare<Check<Want>>()
  .type(nonEmptyStringSchema.or(type("Function").as<CheckFunction<Want>>()))
