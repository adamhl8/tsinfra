import { type } from "arktype"

import type { BooleanWant, ListWant, RecordWant, StringWant } from "#session/handlers/ensure/comparison/comparison.ts"
import {
  booleanWantSchema,
  listWantSchema,
  recordWantSchema,
  stringWantSchema,
} from "#session/handlers/ensure/comparison/comparison.ts"

/**
 * What a step wants: an exit status as a boolean, a string to match, an array of strings to match as a set, or an
 * object of string keys and string values to match by key.
 */
export type Want = BooleanWant | StringWant | ListWant | RecordWant

// Validate an object as a list or as a record in a narrow, because in a union ArkType reports a bad item against both.
// The fallback never shows, because a failed validation always has an error.
const listOrRecordWantSchema = type("object").narrow((want, ctx) => {
  const errors = (Array.isArray(want) ? listWantSchema : recordWantSchema)(want)
  if (!(errors instanceof type.errors)) return true

  const [firstError] = errors
  return firstError
    ? ctx.reject({ path: [...ctx.path, ...firstError.path], expected: firstError.expected, actual: firstError.actual })
    : ctx.mustBe("an array of strings or an object of strings")
})

// Word the problem, because ArkType's own calls the array and the object both "an object".
export const wantSchema = booleanWantSchema
  .or(stringWantSchema)
  .or(listOrRecordWantSchema)
  .configure({
    problem: (ctx) => `must be a boolean, a string, an array of strings, or an object of strings (was ${ctx.actual})`,
  })
  .as<Want>()
