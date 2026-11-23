import { describe, expect, it } from "tstyche"

import type { Host } from "#core/session.ts"
import type { EnsureOptions } from "#core/session/handlers/ensure.ts"
import type { Check } from "#core/session/handlers/ensure/check.ts"
import type { RecordPrimitive, RecordValue } from "#core/session/handlers/ensure/comparison/record.ts"
import type {
  NestedExtraItems,
  NestedExtraKey,
} from "#core/session/handlers/ensure/comparison/record/difference/nested-extra.ts"
import type { FixDifference } from "#core/session/handlers/ensure/fix.ts"
import type { Want, WantOf } from "#core/session/handlers/ensure/want.ts"
import type { ReadTools } from "#core/session/handlers/tools.ts"

declare const h: Host

// Pass a step's options on, like an integration that wraps `h.ensure`.
const ensureOptions = async <T extends WantOf<T>>(options: EnsureOptions<T>) => h.ensure("Pass on", options)

// Build a fix in code that's generic over `want`.
const ensureWant = async <T extends WantOf<T>>(want: T, check: Check<T>) =>
  h.ensure("Build a fix", {
    want,
    check,
    fix: async (_tools, difference) => {
      await Promise.resolve(difference)
    },
  })

// Declare these with `interface`, because an interface has no index signature, unlike a type alias.
interface PowerValues {
  sleep: number
  displaysleep: number
}

interface DefaultsDict {
  [key: string]: DefaultsValue
}

type DefaultsValue = boolean | number | string | DefaultsValue[] | DefaultsDict

/** Returns the type each key of an index signature holds. */
type IndexedValue<T> = T extends Readonly<Record<string, infer V>> ? V : never

interface DeepSetWant {
  a: { b: { c: { d: { e: { f: { g: { h: { i: { packages: ReadonlySet<string> } } } } } } } } }
}

describe("FixDifference", () => {
  it("should give a boolean want's fix only want", () => {
    expect<FixDifference<boolean>>().type.toBe<{ want: boolean }>()
  })

  it("should give a string want's fix got and want", () => {
    expect<FixDifference<string>>().type.toBe<{ got: string; want: string }>()
  })

  it("should give a list want's fix got and want", () => {
    expect<FixDifference<readonly string[]>>().type.toBe<{ got: string[]; want: string[] }>()
  })

  it("should give a set want's fix want, missing, and extra", () => {
    expect<FixDifference<ReadonlySet<string>>>().type.toBe<{
      want: ReadonlySet<string>
      missing: string[]
      extra: string[]
    }>()
  })

  it("should leave nestedExtra out for a record want that can't nest a record or a set", () => {
    expect<FixDifference<Record<string, string>>>().type.toBe<{
      got: Record<string, string>
      want: Record<string, string>
      unmet: Readonly<Record<string, string>>
      extra: Record<string, string>
      differing: Readonly<Record<string, true>>
    }>()
    expect<FixDifference<{ image: string; ports: readonly string[] }>>().type.not.toHaveProperty("nestedExtra")
  })

  it("should type unmet as want's shape with every key optional", () => {
    expect<FixDifference<{ image: string; port: number; ports: readonly string[] }>["unmet"]>().type.toBe<{
      readonly image?: string
      readonly port?: number
      readonly ports?: readonly string[]
    }>()
  })

  it("should keep unmet's index signatures, so their values aren't optional", () => {
    expect<FixDifference<Record<string, { port: number }>>["unmet"]>().type.toBe<
      Readonly<Record<string, { readonly port?: number }>>
    >()
  })

  it("should type unmet's nested sets as sets of want's items", () => {
    expect<FixDifference<{ packages: ReadonlySet<string> }>["unmet"]>().type.toBe<{
      readonly packages?: ReadonlySet<string>
    }>()
  })

  it("should mark each of want's keys that can't hold a record as true, with every key optional", () => {
    expect<FixDifference<{ image: string; port: number; enabled: boolean }>["differing"]>().type.toBe<{
      readonly image?: true
      readonly port?: true
      readonly enabled?: true
    }>()
  })

  it("should mark a nested list and a nested set as true", () => {
    expect<FixDifference<{ ports: readonly string[]; packages: ReadonlySet<string> }>["differing"]>().type.toBe<{
      readonly ports?: true
      readonly packages?: true
    }>()
  })

  it("should mark a nested record as true or its own keys' marks", () => {
    expect<FixDifference<{ env: { TZ: string; PUID: number } }>["differing"]>().type.toBe<{
      readonly env?: true | { readonly TZ?: true; readonly PUID?: true }
    }>()
  })

  it("should keep differing's index signatures, so their values aren't optional", () => {
    expect<FixDifference<Record<string, { port: number }>>["differing"]>().type.toBe<
      Readonly<Record<string, true | { readonly port?: true }>>
    >()
  })

  it("should mark a value that's a string or a record as true or the record's marks", () => {
    expect<FixDifference<{ value: string | { a: number } }>["differing"]>().type.toBe<{
      readonly value?: true | { readonly a?: true }
    }>()
  })

  it("should mark a record want an interface declares", () => {
    expect<FixDifference<{ ac: PowerValues }>["differing"]>().type.toBe<{
      readonly ac?: true | { readonly sleep?: true; readonly displaysleep?: true }
    }>()
  })

  it("should keep a recursive want's marks at every depth of differing", () => {
    type Differing = FixDifference<Record<string, DefaultsDict>>["differing"]
    type Fourth = IndexedValue<IndexedValue<IndexedValue<IndexedValue<Differing>>>>
    type Sixth = IndexedValue<IndexedValue<Fourth>>

    expect<Fourth>().type.toBeAssignableFrom<true>()
    expect<Fourth>().type.not.toBeAssignableFrom<string>()
    expect<Sixth>().type.toBeAssignableFrom<true>()
    expect<Sixth>().type.not.toBeAssignableFrom<string>()
  })

  it("should give only key entries to a want that nests records", () => {
    expect<FixDifference<Partial<Record<"ac" | "battery", Record<string, number>>>>["nestedExtra"]>().type.toBe<
      NestedExtraKey<number>[]
    >()
  })

  it("should give only items entries to a want that nests sets", () => {
    expect<FixDifference<{ packages: ReadonlySet<string> }>["nestedExtra"]>().type.toBe<NestedExtraItems<string>[]>()
  })

  it("should give both entry kinds to a want that nests records and sets", () => {
    expect<FixDifference<{ labels: Record<string, string>; packages: ReadonlySet<string> }>["nestedExtra"]>().type.toBe<
      (NestedExtraKey<string> | NestedExtraItems<string>)[]
    >()
  })

  it("should type a key entry's value by the values of every nested record", () => {
    expect<FixDifference<{ env: { TZ: string; PUID: number }; labels: { app: string } }>["nestedExtra"]>().type.toBe<
      NestedExtraKey<string | number>[]
    >()
  })

  it("should type a record want an interface declares", () => {
    expect<FixDifference<{ ac: PowerValues }>["unmet"]>().type.toBe<{
      readonly ac?: { readonly sleep?: number; readonly displaysleep?: number }
    }>()
  })

  it("should keep a recursive want's type at every depth of unmet", () => {
    type Unmet = FixDifference<Record<string, DefaultsDict>>["unmet"]
    type Fourth = IndexedValue<IndexedValue<IndexedValue<IndexedValue<Unmet>>>>
    type Sixth = IndexedValue<IndexedValue<Fourth>>

    expect<Fourth>().type.toBeAssignableFrom<string>()
    expect<Fourth>().type.not.toBeAssignableFrom<() => number>()
    expect<Sixth>().type.toBeAssignableFrom<string>()
    expect<Sixth>().type.not.toBeAssignableFrom<() => number>()
  })

  it("should give a want nested past the walk's depth looser entries", () => {
    type Entry = FixDifference<DeepSetWant>["nestedExtra"][number]

    // oxlint-disable-next-line typescript/no-unnecessary-type-arguments - the type argument is what this test checks
    expect<Entry>().type.toBeAssignableFrom<NestedExtraKey<RecordValue>>()
    // oxlint-disable-next-line typescript/no-unnecessary-type-arguments - the type argument is what this test checks
    expect<Entry>().type.toBeAssignableFrom<NestedExtraItems<RecordPrimitive>>()
  })

  it("should give a want of any kind the union of each kind's difference", () => {
    expect<FixDifference<Want>>().type.toBeAssignableFrom<{ want: boolean }>()
    expect<FixDifference<Want>>().type.toBeAssignableFrom<{ got: string; want: string }>()
  })
})

describe("h.ensure's fix", () => {
  it("should give a boolean want's fix its difference", () => {
    expect(h.ensure).type.toBeCallableWith("Make marker", {
      want: true,
      check: "true",
      fix: async (_tools: unknown, difference: { want: boolean }) => {
        await Promise.resolve(difference)
      },
    })
  })

  it("should type the difference by an inline want", async () => {
    await h.ensure("Write env", {
      want: { env: { TZ: "UTC", PUID: 1000 }, labels: { app: "web" } },
      check: async ({ read }) => ({ env: { TZ: await read("echo UTC"), PUID: 1 }, labels: { app: "web" } }),
      fix: async ({ exec }, { want, unmet, nestedExtra, differing }) => {
        expect(want.env).type.toBe<{ TZ: string; PUID: number }>()
        expect(unmet.env).type.toBe<{ readonly TZ?: string; readonly PUID?: number } | undefined>()
        expect(nestedExtra).type.toBe<NestedExtraKey<string | number>[]>()
        expect(differing.env).type.toBe<true | { readonly TZ?: true; readonly PUID?: true } | undefined>()
        await exec("true")
      },
    })
  })

  it("should give an inline want that nests no set only key entries", async () => {
    await h.ensure("Set power", {
      want: { ac: { sleep: 0 } },
      check: async ({ read }) => ({ ac: { sleep: Number(await read("echo 0")) } }),
      fix: async ({ exec }, { nestedExtra }) => {
        expect(nestedExtra[0]?.kind).type.toBe<"key" | undefined>()
        await exec("true")
      },
    })
  })

  it("should let generic code pass a step's options on", () => {
    expect(ensureOptions).type.toBeCallableWith({
      want: { a: { b: 1 } },
      check: async ({ read }: ReadTools) => ({ a: { b: Number(await read("echo 1")) } }),
      fix: "true",
    })
  })

  it("should let generic code build a fix", () => {
    expect(ensureWant).type.toBeCallableWith({ a: "1" }, async ({ read }: ReadTools) => ({ a: await read("echo 1") }))
  })
})
