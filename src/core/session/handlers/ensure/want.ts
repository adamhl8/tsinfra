import type { Type } from "arktype"
import { type } from "arktype"

import type { BooleanWant } from "#core/session/handlers/ensure/comparison.ts"
import { booleanWantSchema, getWantKind } from "#core/session/handlers/ensure/comparison.ts"
import type { ListWant } from "#core/session/handlers/ensure/comparison/list.ts"
import { listWantSchema } from "#core/session/handlers/ensure/comparison/list.ts"
import type { RecordWant } from "#core/session/handlers/ensure/comparison/record.ts"
import { recordWantSchema } from "#core/session/handlers/ensure/comparison/record.ts"
import type { SetWant } from "#core/session/handlers/ensure/comparison/set.ts"
import { setWantSchema } from "#core/session/handlers/ensure/comparison/set.ts"
import type { StringWant } from "#core/session/handlers/ensure/comparison/string.ts"
import { stringWantSchema } from "#core/session/handlers/ensure/comparison/string.ts"

/**
 * What a step wants: an exit status as a boolean, a string to match, a list or a set of strings to match as a set, or a
 * record of string keys and string, number, or boolean values to match by key.
 */
export type Want = BooleanWant | StringWant | ListWant | SetWant | RecordWant

/** A `want` with its kind, which validating it decides once, so later code can switch on `kind`. */
export type TaggedWant =
  | { kind: "boolean"; want: BooleanWant }
  | { kind: "string"; want: StringWant }
  | { kind: "list"; want: ListWant }
  | { kind: "set"; want: SetWant }
  | { kind: "record"; want: RecordWant }

/** A kind of `want`, which decides how it's compared. */
export type WantKind = TaggedWant["kind"]

// Name the JS types, because ArkType's own problem calls the array and the object both "an object".
const WANT_TYPES =
  "a boolean, a string, an array of strings, a Set of strings, or an object of strings, numbers, or booleans"

const WANT_SCHEMAS = {
  boolean: booleanWantSchema,
  string: stringWantSchema,
  list: listWantSchema,
  set: setWantSchema,
  record: recordWantSchema,
} satisfies Record<WantKind, Type>

// Validate an object with its kind's schema in a narrow, because in a union ArkType reports a bad item against each
// kind.
// The last fallback never shows, because a failed validation always has an error.
const objectWantSchema = type("object").narrow((want, ctx) => {
  const wantKind = getWantKind(want)
  if (!wantKind) return ctx.mustBe(WANT_TYPES)

  const errors = WANT_SCHEMAS[wantKind](want)
  if (!(errors instanceof type.errors)) return true

  const [firstError] = errors
  return firstError
    ? ctx.reject({ path: [...ctx.path, ...firstError.path], expected: firstError.expected, actual: firstError.actual })
    : ctx.mustBe(WANT_TYPES)
})

export const wantSchema = booleanWantSchema
  .or(stringWantSchema)
  .or(objectWantSchema)
  .configure({ problem: (ctx) => `must be ${WANT_TYPES} (was ${ctx.actual})` })
  .as<Want>()

/** Tags a validated `want` with its kind. */
export const tagWant = (want: Want): TaggedWant =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion - validation used `getWantKind` too, so the kind matches `want`
  ({ kind: getWantKind(want), want }) as TaggedWant
