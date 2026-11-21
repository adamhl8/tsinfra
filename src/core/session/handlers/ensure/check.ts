import { type } from "arktype"

import type { IsRecordWant, SchemaWant } from "#core/session/handlers/ensure/want.ts"
import type { ReadTools } from "#core/session/handlers/tools.ts"
import { nonEmptyStringSchema } from "#core/session/step.ts"

type CheckFunction<T> = (tools: ReadTools) => Promise<T>

/**
 * A step's check: a command, or a function given `ReadTools` that returns the value to compare. A record `want` takes
 * only a function, because a command's output has no keys.
 */
export type Check<T> = IsRecordWant<T> extends true ? CheckFunction<T> : string | CheckFunction<T>

// Type the function as a `CheckFunction`, because only "is a function" can be validated at runtime.
export const checkSchema = type
  .declare<Check<SchemaWant>>()
  .type(nonEmptyStringSchema.or(type("Function").as<CheckFunction<SchemaWant>>()))
