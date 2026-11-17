import type { Type } from "arktype"
import { type } from "arktype"
import type { Result } from "ts-explicit-errors"
import { err, isErr } from "ts-explicit-errors"

import type { ListComparisonValues } from "#core/session/handlers/ensure/comparison/list.ts"
import { compareLists, listWantSchema, toListItems } from "#core/session/handlers/ensure/comparison/list.ts"
import type { RecordComparisonValues } from "#core/session/handlers/ensure/comparison/record.ts"
import { compareRecords, recordWantSchema } from "#core/session/handlers/ensure/comparison/record.ts"
import type { SetComparisonValues } from "#core/session/handlers/ensure/comparison/set.ts"
import { compareSets, setWantSchema } from "#core/session/handlers/ensure/comparison/set.ts"
import type { StringComparisonValues } from "#core/session/handlers/ensure/comparison/string.ts"
import { compareStrings, stringWantSchema } from "#core/session/handlers/ensure/comparison/string.ts"
import type { HostCheckDetails } from "#core/session/handlers/ensure/host-check-details.ts"
import type { TaggedWant, WantKind } from "#core/session/handlers/ensure/want.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import type { CommandOutput } from "#core/transport.ts"
import { createCommandExitError, describeType } from "#utils.ts"

/** A boolean `want`, which a command's exit status or a function's value must match. */
export const booleanWantSchema = type("boolean")
export type BooleanWant = typeof booleanWantSchema.infer

/** What the check gave and what it wanted, as raw values. `kind` says how the output shows them. */
export type EnsureComparisonValues =
  // `got` is the exit code, and `want: true` means exit 0.
  | { kind: "exit"; got: number; want: boolean }
  | { kind: "boolean"; got: boolean; want: boolean }
  | StringComparisonValues
  | ListComparisonValues
  | SetComparisonValues
  | RecordComparisonValues

/**
 * Names the kind of `want` that `value` is shaped like, or nothing for a value no `want` can be. Looks only at the
 * shape, so the kind's schema still checks the rest, like a list's items or that a record is a plain object.
 */
export const getWantKind = (value: unknown): WantKind | undefined => {
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "string") return "string"
  if (Array.isArray(value)) return "list"
  if (value instanceof Set) return "set"
  if (typeof value === "object" && value !== null) return "record"
  return undefined
}

// Wrap each kind's schema in `{ value }`, so an error names the part that's wrong, like `value[1]`.
const CHECK_VALUE_SCHEMAS = {
  boolean: type({ value: booleanWantSchema }),
  string: type({ value: stringWantSchema }),
  list: type({ value: listWantSchema }),
  set: type({ value: setWantSchema }),
  record: type({ value: recordWantSchema }),
} satisfies Record<WantKind, Type<{ value: unknown }>>

/**
 * Validates a check function's value with the schema for `want`'s kind. Names the value's type when it's another kind,
 * because the schema's own error would only say it's wrong. Takes `K` so each caller gets its kind's value type back.
 */
const validateCheckValue = <K extends WantKind>(
  value: unknown,
  taggedWant: Extract<TaggedWant, { kind: K }>,
): Result<(typeof CHECK_VALUE_SCHEMAS)[K]["infer"]["value"]> => {
  const schema = CHECK_VALUE_SCHEMAS[taggedWant.kind]
  const valid = schema({ value })

  if (valid instanceof type.errors) {
    const isSameKind = getWantKind(value) === taggedWant.kind
    const problem = isSameKind
      ? valid.summary
      : `it's of type '${describeType(value)}', but want is of type '${describeType(taggedWant.want)}'`
    return err("failed to validate the value the check returned", err(problem, undefined))
  }

  return valid.value
}

/**
 * Validates a check function's value against `want`'s kind, then compares the two. The value is `unknown` because a
 * script can get past the types and return anything.
 */
const compareFnValue = (value: unknown, taggedWant: TaggedWant): Result<Comparison> => {
  const { kind: wantKind, want } = taggedWant

  if (wantKind === "boolean") {
    const validValue = validateCheckValue(value, taggedWant)
    if (isErr(validValue)) return validValue
    return {
      inSync: validValue === want,
      values: { kind: "boolean", got: validValue, want },
    }
  }
  if (wantKind === "string") {
    const validValue = validateCheckValue(value, taggedWant)
    return isErr(validValue) ? validValue : compareStrings(validValue, want)
  }
  if (wantKind === "list") {
    const validValue = validateCheckValue(value, taggedWant)
    return isErr(validValue) ? validValue : compareLists(validValue, want)
  }
  if (wantKind === "set") {
    const validValue = validateCheckValue(value, taggedWant)
    return isErr(validValue) ? validValue : compareSets(validValue, want)
  }

  const validValue = validateCheckValue(value, taggedWant)
  return isErr(validValue) ? validValue : compareRecords(validValue, want)
}

/**
 * Returns `comparison`, or an error for a check that exited non-zero but whose output still matches, so a broken check
 * can't look converged.
 */
const withExitCodeChecked = (commandOutput: CommandOutput, comparison: Comparison): Result<Comparison> =>
  commandOutput.exitCode !== 0 && comparison.inSync ? createCommandExitError(commandOutput) : comparison

/** Compares a check command's stdout, its lines, or its exit code, to `want`. */
const compareCommandOutput = (commandOutput: CommandOutput, taggedWant: TaggedWant): Result<Comparison> => {
  const { stdout, exitCode } = commandOutput
  const { kind: wantKind, want } = taggedWant

  if (wantKind === "boolean")
    return { inSync: (exitCode === 0) === want, values: { kind: "exit", got: exitCode, want } }

  if (wantKind === "string") return withExitCodeChecked(commandOutput, compareStrings(stdout, want))
  if (wantKind === "list") return withExitCodeChecked(commandOutput, compareLists(toListItems(stdout), want))
  if (wantKind === "set") return withExitCodeChecked(commandOutput, compareSets(toListItems(stdout), want))

  // Validating the options refuses a command check for a record `want`, so this only covers the types.
  return err("a record want needs a check function", undefined)
}

/** Compares what the check found on the host to `want`. */
export const compareCheck = (hostCheckDetails: HostCheckDetails, taggedWant: TaggedWant): Result<Comparison> =>
  hostCheckDetails.kind === "function"
    ? compareFnValue(hostCheckDetails.value, taggedWant)
    : compareCommandOutput(hostCheckDetails.commandOutput, taggedWant)
