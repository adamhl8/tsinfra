// oxlint-disable unicorn/no-null - a record want can hold null, so these tests compare it

import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { attempt } from "ts-explicit-errors"

import {
  castInvalid,
  createSession,
  ensureOrMessage,
  getFailureMessage,
  getFinishedStepRecords,
  throwBoom,
} from "#core/__tests__/session.ts"
import type { Want } from "#core/session/handlers/ensure/want.ts"
import type { ChangeTools } from "#core/session/handlers/tools.ts"

// Read `key=value` lines into a record, the shape a record check returns.
const toRecord = (text: string) =>
  Object.fromEntries(
    text.split("\n").map((line) => {
      const [key = "", value = ""] = line.split("=")
      return [key, value] as const
    }),
  )

/** Returns a record whose nested `a[0]` is `a` itself. */
const createSelfHoldingList = () => {
  const a: unknown[] = []
  a.push(a)
  return { a }
}

/** Returns a record whose nested `a.self` is `a` itself. */
const createSelfHoldingRecord = () => {
  const a: Record<string, unknown> = { b: "1" }
  a["self"] = a
  return { a }
}

// Widen `want` to the union, which lets a mismatched check through the types, as an untyped host script would.
const toLooseWant = (value: Want) => value

// Declare these with `interface`, because an interface has no index signature, unlike a type alias.
interface ServiceConfig {
  image: string
  env: ServiceEnv
  ports: readonly number[]
  replicas?: number
}

interface ServiceEnv {
  TZ: string
}

interface ScheduledService {
  startAt: Date
}

const SERVICE_CONFIG: ServiceConfig = { image: "caddy", env: { TZ: "UTC" }, ports: [80, 443] }

/** Returns a path in a new temp dir, plus a step that creates a file there. */
const createMarkerStep = async () => {
  const marker = path.join(await makeTempDir(), "marker")
  return { marker, options: { want: true, check: `test -f '${marker}'`, fix: `touch '${marker}'` } }
}

describe("h.ensure", () => {
  it("should return unchanged without running the fix when the check passes", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: true, check: "true", fix: "exit 1" })).toMatchObject({ changed: false })
  })

  it("should run the fix in apply and return changed", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = await createSession("apply")

    expect(await ensureOrMessage(h, options)).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(true)
  })

  it("should return changed in plan without running the fix", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = await createSession("plan")

    expect(await ensureOrMessage(h, options)).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host when the fix fails", async () => {
    const hostSession = await createSession()
    const message = "failed to run the fix -> exited with code 2: nope"

    expect(await ensureOrMessage(hostSession.host, { want: true, check: "false", fix: "echo nope >&2; exit 2" })).toBe(
      message,
    )
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when the host's state still differs after the fix", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: true, check: "false", fix: "true" })).toBe(
      "the host's state still differs after the fix",
    )
  })

  it("should accept a function check that uses the given read", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: true,
      check: async ({ read }) => (await read("echo yes")) === "yes",
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should return unchanged when want is false and the check exits non-zero", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: false, check: "false", fix: "exit 1" })).toMatchObject({ changed: false })
  })

  it("should run the fix when want is false and the check exits 0", async () => {
    const { marker } = await createMarkerStep()
    await bun.write(marker, "")
    const { host: h } = await createSession()

    expect(
      await ensureOrMessage(h, { want: false, check: `test -f '${marker}'`, fix: `rm '${marker}'` }),
    ).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should compare the boolean a function check returns to want", async () => {
    const { host: h } = await createSession()

    const result = await ensureOrMessage(h, {
      want: false,
      check: async ({ read }) => (await read("echo no")) === "yes",
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should fail validation when a function check returns a different type than want", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: toLooseWant("active"),
      check: async ({ read }) => (await read("echo active")) === "active",
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> it's of type 'boolean', but want is of type 'string'",
    )
  })

  it("should fail the host with the step's name when a function check throws", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: true, check: throwBoom, fix: "true" })).toBe(
      "failed to compare the host with what the step wants -> boom",
    )
  })

  it("should validate an Error a function check returns as a value, not a thrown error", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: true,
      check: castInvalid(() => new Error("returned")),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> it's of type 'Error', but want is of type 'boolean'",
    )
  })

  it("should name the step when a read inside a function check fails", async () => {
    const hostSession = await createSession()
    const message =
      "failed to compare the host with what the step wants -> failed to read 'exit 1' -> exited with code 1"
    const result = await ensureOrMessage(hostSession.host, {
      want: true,
      check: async ({ read }) => (await read("exit 1")) === "",
      fix: "true",
    })

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the step when a function check catches a failed read", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: true,
      check: async ({ read }) => {
        await attempt(async () => read("exit 1"))
        return true
      },
      fix: "true",
    })

    expect(result).toBe("failed to read 'exit 1' -> exited with code 1")
  })
})

/** Returns a path in a new temp dir, plus a step that writes `value` there. */
const createValueStep = async (value: string) => {
  const file = path.join(await makeTempDir(), "value")
  return {
    file,
    options: { want: value, check: `cat '${file}' 2>/dev/null`, fix: `printf '%s\\n' '${value}' > '${file}'` },
  }
}

describe("h.ensure with a string want", () => {
  it("should return unchanged without running the fix when the output matches", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: "v2", check: "echo v2", fix: "exit 1" })).toMatchObject({
      changed: false,
    })
  })

  it("should ignore trailing newlines on both sides", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: "v2\n", check: String.raw`printf 'v2\n\n'`, fix: "exit 1" })).toMatchObject(
      { changed: false },
    )
  })

  it("should return changed in plan without running the fix", async () => {
    const { file, options } = await createValueStep("v2")
    const { host: h } = await createSession("plan")

    expect(await ensureOrMessage(h, options)).toMatchObject({ changed: true })
    expect(await bun.file(file).exists()).toBe(false)
  })

  it("should run the fix in apply and return changed", async () => {
    const { file, options } = await createValueStep("v2")
    const { host: h } = await createSession("apply")

    expect(await ensureOrMessage(h, options)).toMatchObject({ changed: true })
    expect(await bun.file(file).text()).toBe("v2\n")
  })

  it("should fail a check that exits non-zero but matches want", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: "v2", check: "echo v2; echo broken >&2; exit 1", fix: "true" })).toBe(
      "failed to compare the host with what the step wants -> exited with code 1: broken",
    )
  })

  it("should treat a check that exits non-zero with other output as a mismatch", async () => {
    const { host: h } = await createSession("plan")

    expect(await ensureOrMessage(h, { want: "active", check: "echo inactive; exit 3", fix: "true" })).toMatchObject({
      changed: true,
    })
  })

  it("should compare the string a function check returns", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: "v2",
      check: async ({ read }) => (await read("echo V2")).toLowerCase(),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })
})

describe("h.ensure with a list want", () => {
  it("should compare a command's lines in order", async () => {
    const { host: h } = await createSession()

    expect(
      await ensureOrMessage(h, { want: ["a", "b"], check: String.raw`printf 'a\nb\n'`, fix: "exit 1" }),
    ).toMatchObject({ changed: false })
  })

  it("should find a reorder", async () => {
    const { host: h } = await createSession("plan")

    expect(
      await ensureOrMessage(h, { want: ["a", "b"], check: String.raw`printf 'b\na\n'`, fix: "true" }),
    ).toMatchObject({ changed: true })
  })

  it("should count a duplicate", async () => {
    const { host: h } = await createSession("plan")

    expect(await ensureOrMessage(h, { want: ["a"], check: String.raw`printf 'a\na\n'`, fix: "true" })).toMatchObject({
      changed: true,
    })
  })

  it("should leave out a command's empty and whitespace-only lines", async () => {
    const { host: h } = await createSession()

    expect(
      await ensureOrMessage(h, { want: ["a", "b"], check: String.raw`printf 'a\n\n  \nb\n'`, fix: "exit 1" }),
    ).toMatchObject({ changed: false })
  })

  it("should keep a line's other whitespace, so it differs from the item without it", async () => {
    const { host: h } = await createSession("plan")

    expect(await ensureOrMessage(h, { want: ["a"], check: String.raw`printf 'a \n'`, fix: "true" })).toMatchObject({
      changed: true,
    })
  })

  it("should be in sync with an empty want when the check prints nothing", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: [], check: "true", fix: "exit 1" })).toMatchObject({ changed: false })
  })

  it("should not be in sync with an empty want when the check prints items", async () => {
    const { host: h } = await createSession("plan")

    expect(await ensureOrMessage(h, { want: [], check: "echo a", fix: "true" })).toMatchObject({ changed: true })
  })

  it("should give the fix the host's list as got, and want, and return changed once it matches", async () => {
    const marker = path.join(await makeTempDir(), "domains")
    const { host: h } = await createSession()
    const differences: unknown[] = []
    const result = await ensureOrMessage(h, {
      want: ["a", "b"],
      check: String.raw`cat '${marker}' 2>/dev/null || printf 'b\na\n'`,
      fix: async ({ exec }, difference) => {
        differences.push(difference)
        await exec(String.raw`printf 'a\nb\n' > '${marker}'`)
      },
    })

    expect([result, differences]).toStrictEqual([
      { name: "Make marker", kind: "ensure", changed: true },
      [{ got: ["b", "a"], want: ["a", "b"] }],
    ])
  })

  it("should fail a check that exits non-zero but matches want", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: ["a"], check: "echo a; echo broken >&2; exit 1", fix: "true" })).toBe(
      "failed to compare the host with what the step wants -> exited with code 1: broken",
    )
  })

  it("should compare the list a function check returns in order", async () => {
    const { host: h } = await createSession("plan")
    const result = await ensureOrMessage(h, {
      want: ["b", "a"],
      check: async ({ read }) => (await read(String.raw`printf 'a\nb\n'`)).split("\n"),
      fix: "true",
    })

    expect(result).toMatchObject({ changed: true })
  })

  it("should fail validation when a function check returns a string for a list want", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: toLooseWant(["a"]),
      check: async ({ read }) => read("echo a"),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> it's of type 'string', but want is of type 'array'",
    )
  })

  it("should fail validation when a function check returns a list with an item that isn't a string", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, { want: ["a"], check: () => castInvalid(["a", 1]), fix: "true" })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> value[1] must be a string (was a number)",
    )
  })
})

describe("h.ensure with a set want", () => {
  it("should take a command check and compare its lines as a set, so order and duplicates don't count", async () => {
    const { host: h } = await createSession()

    expect(
      await ensureOrMessage(h, { want: new Set(["a", "b"]), check: String.raw`printf 'b\na\na\n'`, fix: "exit 1" }),
    ).toMatchObject({ changed: false })
  })

  it("should compare the Set a function check returns", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: new Set(["b", "a"]),
      check: async ({ read }) => new Set((await read(String.raw`printf 'a\nb\n'`)).split("\n")),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should give the fix the wanted set and what's missing and extra, and return changed once they're gone", async () => {
    const marker = path.join(await makeTempDir(), "packages")
    const { host: h } = await createSession()
    const differences: unknown[] = []
    const result = await ensureOrMessage(h, {
      want: new Set(["a", "b"]),
      check: String.raw`cat '${marker}' 2>/dev/null || printf 'a\nc\n'`,
      fix: async ({ exec }, difference) => {
        differences.push(difference)
        await exec(String.raw`printf 'a\nb\n' > '${marker}'`)
      },
    })

    expect([result, differences]).toStrictEqual([
      { name: "Make marker", kind: "ensure", changed: true },
      [{ want: new Set(["a", "b"]), missing: ["b"], extra: ["c"] }],
    ])
  })

  it("should take an empty Set as a set of strings, and give its fix what's extra", async () => {
    const { host: h } = await createSession()
    const extras: string[][] = []
    await h.ensure("Clear the items", {
      want: new Set(),
      check: "echo a",
      fix: async ({ exec }, { extra }) => {
        extras.push(extra)
        await exec("true")
      },
      verify: false,
    })

    expect(extras).toStrictEqual([["a"]])
  })

  it("should fail validation when a function check returns an array for a set want", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: new Set(["a"]),
      // @ts-expect-error - a set want's check function returns a Set, so an array is a type error
      check: async ({ read }) => (await read("echo a")).split("\n"),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> it's of type 'array', but want is of type 'Set'",
    )
  })

  it("should fail validation when a function check returns a Set with an item that isn't a string", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: new Set(["a"]),
      check: () => castInvalid(new Set(["a", 1])),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> value must be a Set of strings (was a Set holding an item of type 'number')",
    )
  })
})

describe("h.ensure with a record want", () => {
  it("should compare a function's record by key, so key order doesn't count", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: { a: "1", b: "2" },
      check: async ({ read }) => toRecord(await read(String.raw`printf 'b=2\na=1\n'`)),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should give the fix got, want, unmet, and extra, and return changed once they're gone", async () => {
    const marker = path.join(await makeTempDir(), "versions")
    const { host: h } = await createSession()
    const differences: unknown[] = []
    const result = await ensureOrMessage(h, {
      want: { a: "1", b: "2", d: "4" },
      check: async ({ read }) =>
        toRecord(await read(String.raw`cat '${marker}' 2>/dev/null || printf 'a=1\nc=3\nb=9\n'`)),
      fix: async ({ exec }, difference) => {
        differences.push(difference)
        await exec(String.raw`printf 'a=1\nb=2\nd=4\n' > '${marker}'`)
      },
    })

    expect([result, differences]).toStrictEqual([
      { name: "Make marker", kind: "ensure", changed: true },
      [
        {
          got: { a: "1", c: "3", b: "9" },
          want: { a: "1", b: "2", d: "4" },
          unmet: { b: "2", d: "4" },
          extra: { c: "3" },
          nestedExtra: [],
        },
      ],
    ])
  })

  it("should give the fix unmet in want's key order", async () => {
    const marker = path.join(await makeTempDir(), "versions")
    const { host: h } = await createSession()
    const unmetKeys: string[][] = []
    await ensureOrMessage(h, {
      want: { a: "1", b: "2", d: "4" },
      check: async ({ read }) => toRecord(await read(String.raw`cat '${marker}' 2>/dev/null || printf 'b=9\n'`)),
      fix: async ({ exec }, { unmet }) => {
        unmetKeys.push(Object.keys(unmet))
        await exec(String.raw`printf 'a=1\nb=2\nd=4\n' > '${marker}'`)
      },
    })

    expect(unmetKeys).toStrictEqual([["a", "b", "d"]])
  })

  it("should compare numbers and booleans by key", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: { port: 8080, enabled: true, name: "web" },
      check: async ({ read }) => ({
        port: Number(await read("echo 8080")),
        enabled: (await read("echo yes")) === "yes",
        name: "web",
      }),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should never match a number to a string that reads the same", async () => {
    const hostSession = await createSession("plan")
    const result = await ensureOrMessage(hostSession.host, {
      want: toLooseWant({ port: 8080 }),
      check: async ({ read }) => ({ port: await read("echo 8080") }),
      fix: "true",
    })

    expect([result, getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values]).toMatchObject([
      { changed: true },
      { kind: "record", got: { port: "8080" }, unmet: { port: 8080 } },
    ])
  })

  it("should give the fix the host's values and the unmet ones with the want's own type", async () => {
    const marker = path.join(await makeTempDir(), "port")
    const { host: h } = await createSession()
    const ports: number[] = []
    const result = await ensureOrMessage(h, {
      want: { port: 8080 },
      check: async ({ read }) => ({ port: Number(await read(`cat '${marker}' 2>/dev/null || echo 80`)) }),
      fix: async ({ exec }, { got, unmet }) => {
        ports.push(got.port, ...Object.values(unmet))
        await exec(`echo 8080 > '${marker}'`)
      },
    })

    expect([result, ports]).toStrictEqual([{ name: "Make marker", kind: "ensure", changed: true }, [80, 8080]])
  })

  it("should compare nested records by key, so key order doesn't count at any depth", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: { name: "web", env: { TZ: "UTC", PUID: 1000, debug: { verbose: false, level: null } } },
      check: async ({ read }) => ({
        env: { debug: { level: null, verbose: false }, PUID: Number(await read("echo 1000")), TZ: "UTC" },
        name: "web",
      }),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should compare a nested list in order and a nested set as a set, at any depth", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: {
        packages: new Set(["fd", "jq"]),
        services: [{ name: "web", ports: ["80", "443"], tags: new Set([1, null]) }],
      },
      check: async ({ read }) => ({
        packages: new Set((await read(String.raw`printf 'jq\nfd\n'`)).split("\n")),
        services: [{ tags: new Set([null, 1]), ports: ["80", "443"], name: "web" }],
      }),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it.each([
    {
      description: "a number against a string that reads the same",
      want: { env: { PUID: 1000 } },
      got: { env: { PUID: "1000" } },
      unmet: { env: { PUID: 1000 } },
      nestedExtra: [],
    },
    {
      description: "a key only the check found",
      want: { env: { TZ: "UTC" } },
      got: { env: { TZ: "UTC", PUID: "1" } },
      unmet: {},
      nestedExtra: [{ kind: "key", path: ["env", "PUID"], value: "1" }],
    },
    {
      description: "a key only want has",
      want: { env: { TZ: "UTC", PUID: "1" } },
      got: { env: { TZ: "UTC" } },
      unmet: { env: { PUID: "1" } },
      nestedExtra: [],
    },
    {
      description: "null against a missing key",
      want: { env: { TZ: null } },
      got: { env: {} },
      unmet: { env: { TZ: null } },
      nestedExtra: [],
    },
    {
      description: "a list in another order",
      want: { env: { ports: ["80", "443"] } },
      got: { env: { ports: ["443", "80"] } },
      unmet: { env: { ports: ["80", "443"] } },
      nestedExtra: [],
    },
    {
      description: "a Set against an array",
      want: { env: { tags: new Set(["a"]) } },
      got: { env: { tags: ["a"] } },
      unmet: { env: { tags: new Set(["a"]) } },
      nestedExtra: [],
    },
    {
      description: "a set with another item",
      want: { env: { tags: new Set(["a"]) } },
      got: { env: { tags: new Set(["b"]) } },
      unmet: { env: { tags: new Set(["a"]) } },
      nestedExtra: [{ kind: "items", path: ["env", "tags"], value: ["b"] }],
    },
    {
      description: "a record in a list",
      want: { env: { services: [{ name: "web", port: 80 }] } },
      got: { env: { services: [{ name: "web", port: 81 }] } },
      unmet: { env: { services: [{ name: "web", port: 80 }] } },
      nestedExtra: [],
    },
  ])("should record the difference in a nested record for $description", async ({ want, got, unmet, nestedExtra }) => {
    const hostSession = await createSession("plan")
    const result = await ensureOrMessage(hostSession.host, {
      want: toLooseWant(want),
      check: () => castInvalid(got),
      fix: "true",
    })

    const values = getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values
    const difference: unknown =
      values?.kind === "record" ? { unmet: values.unmet, nestedExtra: values.nestedExtra } : undefined
    expect(result).toMatchObject({ changed: true })
    // Compare with `toStrictEqual`, because `toMatchObject` takes any two Sets as matching.
    expect(difference).toStrictEqual({ unmet, nestedExtra })
  })

  it("should tell null from a missing key at the top level", async () => {
    const hostSession = await createSession("plan")
    const result = await ensureOrMessage(hostSession.host, {
      want: { a: null },
      check: () => castInvalid({}),
      fix: "true",
    })

    expect([result, getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values]).toMatchObject([
      { changed: true },
      { kind: "record", unmet: { a: null } },
    ])
  })

  it("should give the fix unmet at any depth, and extra at the top level", async () => {
    const marker = path.join(await makeTempDir(), "config")
    const { host: h } = await createSession()
    const differences: unknown[] = []
    const result = await ensureOrMessage(h, {
      want: toLooseWant({ env: { TZ: "UTC", PUID: 1000 }, labels: { app: "web" } }),
      check: async ({ read }) =>
        (await read(`cat '${marker}' 2>/dev/null || true`)) === "done"
          ? { env: { TZ: "UTC", PUID: 1000 }, labels: { app: "web" } }
          : { env: { TZ: "UTC", PUID: 1 }, ports: { http: 80 } },
      fix: async ({ exec }, difference) => {
        differences.push(difference)
        await exec(`echo done > '${marker}'`)
      },
    })

    expect([result, differences]).toStrictEqual([
      { name: "Make marker", kind: "ensure", changed: true },
      [
        {
          got: { env: { TZ: "UTC", PUID: 1 }, ports: { http: 80 } },
          want: { env: { TZ: "UTC", PUID: 1000 }, labels: { app: "web" } },
          unmet: { env: { PUID: 1000 }, labels: { app: "web" } },
          extra: { ports: { http: 80 } },
          nestedExtra: [],
        },
      ],
    ])
  })

  it("should give the fix nested values with the want's own type", async () => {
    const marker = path.join(await makeTempDir(), "port")
    const { host: h } = await createSession()
    const ports: (number | undefined)[] = []
    await ensureOrMessage(h, {
      want: { web: { port: 8080 } },
      check: async ({ read }) => ({ web: { port: Number(await read(`cat '${marker}' 2>/dev/null || echo 80`)) } }),
      fix: async ({ exec }, { got, unmet }) => {
        ports.push(got.web.port, unmet.web?.port)
        await exec(`echo 8080 > '${marker}'`)
      },
    })

    expect(ports).toStrictEqual([80, 8080])
  })

  it("should give the fix a nested list whole and a nested set's missing items", async () => {
    // Type `ports` as readonly, so the test stops compiling if a nested list can't be.
    const ports: readonly string[] = ["80", "443"]
    const { host: h } = await createSession()
    const differences: unknown[] = []
    await ensureOrMessage(h, {
      want: { packages: new Set(["fd", "jq"]), ports },
      check: async ({ read }) => ({ packages: new Set([await read("echo jq")]), ports: [] }),
      fix: async (_, difference) => {
        differences.push(difference)
        await Promise.resolve()
      },
      verify: false,
    })

    expect(differences).toStrictEqual([
      {
        got: { packages: new Set(["jq"]), ports: [] },
        want: { packages: new Set(["fd", "jq"]), ports: ["80", "443"] },
        unmet: { packages: new Set(["fd"]), ports: ["80", "443"] },
        extra: {},
        nestedExtra: [],
      },
    ])
  })

  it("should give the fix a nested set with the want's own type", async () => {
    const { host: h } = await createSession()
    const sets: (ReadonlySet<string> | undefined)[] = []
    await ensureOrMessage(h, {
      want: { packages: new Set(["fd"]) },
      check: async ({ read }) => ({ packages: new Set([await read("echo jq")]) }),
      fix: async (_, { got, unmet }) => {
        sets.push(got.packages, unmet.packages)
        await Promise.resolve()
      },
      verify: false,
    })

    expect(sets).toStrictEqual([new Set(["jq"]), new Set(["fd"])])
  })

  it.each([
    {
      description: "a nested record that differs",
      want: { env: { TZ: "UTC", PUID: 1000 } },
      got: { env: { TZ: "UTC", PUID: 1 } },
      unmet: { env: { PUID: 1000 } },
      nestedExtra: [],
    },
    {
      description: "a key the host lacks",
      want: { env: { TZ: "UTC" }, labels: {} },
      got: {},
      unmet: { env: { TZ: "UTC" }, labels: {} },
      nestedExtra: [],
    },
    {
      description: "a value of another kind",
      want: { env: { TZ: "UTC" } },
      got: { env: "TZ=UTC" },
      unmet: { env: { TZ: "UTC" } },
      nestedExtra: [],
    },
    {
      description: "a nested list that differs",
      want: { ports: ["80", "443"] },
      got: { ports: ["443", "8080"] },
      unmet: { ports: ["80", "443"] },
      nestedExtra: [],
    },
    {
      description: "a nested set that differs",
      want: { tags: new Set(["a", "b"]) },
      got: { tags: new Set(["c", "a", "d"]) },
      unmet: { tags: new Set(["b"]) },
      nestedExtra: [{ kind: "items", path: ["tags"], value: ["c", "d"] }],
    },
    {
      description: "an empty nested record whose host value has keys",
      want: { env: {} },
      got: { env: { TZ: "UTC" } },
      unmet: {},
      nestedExtra: [{ kind: "key", path: ["env", "TZ"], value: "UTC" }],
    },
  ])("should give the fix unmet and nestedExtra for $description", async ({ want, got, unmet, nestedExtra }) => {
    const { host: h } = await createSession()
    const differences: unknown[] = []
    await ensureOrMessage(h, {
      want: toLooseWant(want),
      check: () => castInvalid(got),
      fix: async (_, difference) => {
        differences.push(difference)
        await Promise.resolve()
      },
      verify: false,
    })

    expect(differences).toStrictEqual([{ got, want, unmet, extra: {}, nestedExtra }])
  })

  it("should give the fix nestedExtra in want's key order, with a record's own extra keys after its nested ones", async () => {
    const want = { a: { b: { x: 1 }, c: 1 }, s: new Set([1]) }
    const got = { s: new Set([2, 1]), a: { z: 9, b: { y: 1, x: 1 }, c: 1 }, top: 1 }
    const { host: h } = await createSession()
    const differences: unknown[] = []
    await ensureOrMessage(h, {
      want: toLooseWant(want),
      check: () => castInvalid(got),
      fix: async (_, difference) => {
        differences.push(difference)
        await Promise.resolve()
      },
      verify: false,
    })

    expect(differences).toStrictEqual([
      {
        got,
        want,
        unmet: {},
        extra: { top: 1 },
        nestedExtra: [
          { kind: "key", path: ["a", "b", "y"], value: 1 },
          { kind: "key", path: ["a", "z"], value: 9 },
          { kind: "items", path: ["s"], value: [2] },
        ],
      },
    ])
  })

  it("should mask a secret in a nested set", async () => {
    const hostSession = await createSession("plan")
    await ensureOrMessage(hostSession.host, {
      want: { tokens: new Set(["other"]) },
      check: async ({ read }) => ({ tokens: new Set([await read("echo s3cret-token")]) }),
      fix: "true",
      secretEnv: { TOKEN: "s3cret-token" },
    })

    const values = getFinishedStepRecords(hostSession.hostRecord)[0]?.comparisons.before?.values
    // Compare the set itself, because `toMatchObject` takes any two Sets as matching.
    expect(values?.kind === "record" ? values.got["tokens"] : undefined).toStrictEqual(new Set(["[MASKED]"]))
  })

  it("should name the path when a function check returns a Map in a nested record", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: { a: { b: "1" } },
      check: () => castInvalid({ a: { b: new Map() } }),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> value.a.b must be a plain object (was Map)",
    )
  })

  it("should name the path when a function check returns a record that holds itself", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: { a: { b: "1" } },
      check: () => castInvalid(createSelfHoldingRecord()),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> value.a.self must be a value of its own (was a record that holds it)",
    )
  })

  it("should name the path when a function check returns a list that holds itself", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: { a: ["1"] },
      check: () => castInvalid(createSelfHoldingList()),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> value.a[0] must be a value of its own (was a list that holds it)",
    )
  })

  it("should match -0 to 0 at any depth", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: { port: 0, env: { offset: -0 }, items: [-0, { n: -0 }], ids: new Set([-0]) },
      check: async ({ read }) => ({
        port: Number(await read("echo -0")),
        env: { offset: 0 },
        items: [0, { n: 0 }],
        ids: new Set([0]),
      }),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should accept a nested record that appears at two keys", async () => {
    const { host: h } = await createSession()
    const env = { TZ: "UTC" }
    const result = await ensureOrMessage(h, {
      want: { web: env, worker: env },
      check: () => castInvalid({ web: { TZ: "UTC" }, worker: { TZ: "UTC" } }),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should refuse a command check for a record want without running it", async () => {
    const { marker } = await createMarkerStep()
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, { want: { a: "1" }, check: castInvalid(`touch '${marker}'`), fix: "true" })

    expect([result, await bun.file(marker).exists()]).toStrictEqual([
      "failed to validate the options given to 'ensure' -> check must be a check function for a record want (was a command)",
      false,
    ])
  })

  it("should fail validation when a function check returns an array for a record want", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: toLooseWant({ a: "1" }),
      check: async ({ read }) => (await read("echo a")).split("\n"),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> it's of type 'array', but want is of type 'object'",
    )
  })

  it("should accept a record want an interface declares, at any depth", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: SERVICE_CONFIG,
      check: async ({ read }) => ({ ...SERVICE_CONFIG, env: { TZ: await read("echo UTC") } }),
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should give the fix the difference for a record want an interface declares", async () => {
    const { host: h } = await createSession()
    const unmets: unknown[] = []
    await ensureOrMessage(h, {
      want: SERVICE_CONFIG,
      check: async ({ read }) => ({ ...SERVICE_CONFIG, image: await read("echo nginx") }),
      fix: async ({ exec }, { unmet }) => {
        unmets.push(unmet)
        await exec("true")
      },
      verify: false,
    })

    expect(unmets).toStrictEqual([{ image: "caddy" }])
  })

  it("should refuse a command check for a record want an interface declares", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: SERVICE_CONFIG,
      // @ts-expect-error - a record want takes only a check function
      check: "true",
      fix: "true",
    })

    expect(result).toBe(
      "failed to validate the options given to 'ensure' -> check must be a check function for a record want (was a command)",
    )
  })

  it("should refuse a Date in a record want an interface declares", async () => {
    const { host: h } = await createSession()
    const want: ScheduledService = { startAt: new Date(0) }
    const result = await ensureOrMessage(h, {
      // @ts-expect-error - a Date isn't a record value
      want,
      check: () => castInvalid(want),
      fix: "true",
    })

    expect(result).toBe(
      "failed to validate the options given to 'ensure' -> want.startAt must be a plain object (was Date)",
    )
  })

  it("should fail validation when a function check returns a Map for a record want", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: { a: "1" },
      check: () => castInvalid(new Map([["a", "1"]])),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> value must be a plain object (was Map)",
    )
  })
})

describe("h.ensure with verify: false", () => {
  it("should return changed without checking again after the fix", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: true, check: "false", fix: "true", verify: false })).toMatchObject({
      changed: true,
    })
  })

  it("should still fail the host when the fix fails", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: true, check: "false", fix: "exit 2", verify: false })).toBe(
      "failed to run the fix -> exited with code 2",
    )
  })
})

describe("h.ensure with needs", () => {
  it("should wait in plan without checking when a needed step would change", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { want: true, check: "false", fix: "true" })
    const result = await h.ensure("Install fish plugins", { needs: [brew], want: true, check: "exit 1", fix: "true" })

    expect(result).toStrictEqual({ name: "Install fish plugins", kind: "ensure", changed: true })
    expect(getFinishedStepRecords(hostSession.hostRecord)[1]).toMatchObject({
      status: "waiting",
      waitingOn: ["Install brew packages"],
      commands: [],
    })
  })

  it("should check as usual in plan when every needed step is unchanged", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { want: true, check: "true", fix: "true" })
    await h.ensure("Install fish plugins", { needs: [brew], want: true, check: "false", fix: "true" })

    expect(getFinishedStepRecords(hostSession.hostRecord)[1]?.status).toBe("changed")
  })

  it("should check as usual in plan when needs is empty", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    await h.ensure("Install fish plugins", { needs: [], want: true, check: "false", fix: "true" })

    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.status).toBe("changed")
  })

  it("should wait on a needed step that is itself waiting, and name it", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { want: true, check: "false", fix: "true" })
    const fish = await h.ensure("Install fish", { needs: [brew], want: true, check: "true", fix: "true" })
    await h.ensure("Install fish plugins", { needs: [fish], want: true, check: "true", fix: "true" })

    expect(getFinishedStepRecords(hostSession.hostRecord)[2]).toMatchObject({
      status: "waiting",
      waitingOn: ["Install fish"],
    })
  })

  it("should ignore needs in apply", async () => {
    const hostSession = await createSession("apply")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { want: true, check: "false", fix: "true", verify: false })
    await h.ensure("Install fish plugins", { needs: [brew], want: true, check: "true", fix: "true" })

    expect(getFinishedStepRecords(hostSession.hostRecord)[1]).toMatchObject({
      status: "unchanged",
      commands: [{ cmd: "true" }],
    })
  })
})

describe("h.ensure with the inspect tool", () => {
  it("should treat a missing file as a needed fix in a check function", async () => {
    const { marker } = await createMarkerStep()
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: true,
      check: async ({ inspect }) => (await inspect(`cat '${marker}'`)).exitCode === 0,
      fix: `touch '${marker}'`,
    })

    expect(result).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(true)
  })

  it("should give a fix function the exit code of a command", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      ...options,
      fix: async ({ exec, inspect }) => {
        const { exitCode } = await inspect("exit 4")
        await exec(`printf '%s' '${exitCode}' > '${marker}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await bun.file(marker).text()).toBe("4")
  })
})

describe("h.ensure with a fix function", () => {
  it("should run the commands in order and return changed", async () => {
    const file = path.join(await makeTempDir(), "lines")
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: true,
      check: `test -s '${file}'`,
      fix: async ({ exec }) => {
        await exec(`echo a >> '${file}'`)
        await exec(`echo b >> '${file}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await bun.file(file).text()).toBe("a\nb\n")
  })

  it("should return each command's stdout trimmed", async () => {
    const file = path.join(await makeTempDir(), "value")
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: true,
      check: `test -f '${file}'`,
      fix: async ({ exec }) => {
        const value = await exec(String.raw`printf '  v\n\n'`)
        await exec(`printf '%s' '${value}' > '${file}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await bun.file(file).text()).toBe("v")
  })

  it("should stop at the first failed command and fail the host with the step's name", async () => {
    const { marker, options } = await createMarkerStep()
    const hostSession = await createSession()
    const message = "failed to run the fix -> failed to run 'echo nope >&2; exit 2' -> exited with code 2: nope"
    const result = await ensureOrMessage(hostSession.host, {
      ...options,
      fix: async ({ exec }) => {
        await exec("echo nope >&2; exit 2")
        await exec(`touch '${marker}'`)
      },
    })

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should fail the step when the fix function catches a failed command", async () => {
    const { marker, options } = await createMarkerStep()
    const cmd = `touch '${marker}'; exit 1`
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      ...options,
      fix: async ({ exec }) => {
        await attempt(async () => exec(cmd))
      },
    })

    expect(result).toBe(`failed to run '${cmd}' -> exited with code 1`)
  })

  it("should fail the host with the step's name when the fix function throws", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { want: true, check: "false", fix: throwBoom })).toBe(
      "failed to run the fix -> boom",
    )
  })

  it("should ignore an Error the fix function returns", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      ...options,
      fix: castInvalid(async ({ exec }: ChangeTools) => {
        await exec(`touch '${marker}'`)
        return new Error("returned")
      }),
    })

    expect(result).toMatchObject({ changed: true })
  })

  it("should not call the fix function in plan", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = await createSession("plan")
    const result = await ensureOrMessage(h, {
      ...options,
      fix: async ({ exec }) => {
        await exec(`touch '${marker}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(false)
  })
})

describe("h.ensure with input on the tools", () => {
  it("should give a check's read the input", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      want: true,
      check: async ({ read }) => (await read("cat", { input: "yes" })) === "yes",
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should give a fix's exec the input", async () => {
    const file = path.join(await makeTempDir(), "value")
    const { host: h } = await createSession("apply")
    const result = await ensureOrMessage(h, {
      want: "from the input",
      check: `cat '${file}' 2>/dev/null`,
      fix: async ({ exec }) => {
        await exec(`cat > '${file}'`, { input: "from the input" })
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await bun.file(file).text()).toBe("from the input")
  })
})

describe("h.ensure with invalid input", () => {
  it.each([
    {
      description: "whose want is none of the kinds it can be",
      options: { want: 1, check: "true", fix: "true" },
      message:
        "want must be a boolean, a string, an array of strings, a Set of strings, or an object (of strings, numbers, booleans, null, arrays, Sets, or nested objects) (was a number)",
    },
    {
      description: "whose want is a Set with an item that isn't a string",
      options: { want: new Set(["a", 1]), check: "true", fix: "true" },
      message: "want must be a Set of strings (was a Set holding an item of type 'number')",
    },
    {
      description: "whose want is a Map",
      options: { want: new Map([["a", "1"]]), check: "true", fix: "true" },
      message: "want must be a plain object (was Map)",
    },
    {
      description: "whose want is a Promise, from a missing await",
      options: { want: Promise.resolve({ a: "1" }), check: "true", fix: "true" },
      message: "want must be a plain object (was Promise)",
    },
    {
      description: "whose want is a function",
      options: { want: () => "a", check: "true", fix: "true" },
      message:
        "want must be a boolean, a string, an array of strings, a Set of strings, or an object (of strings, numbers, booleans, null, arrays, Sets, or nested objects) (was Function(want))",
    },
    {
      description: "whose want is a record with a Map in a nested record",
      options: { want: { a: { b: new Map() } }, check: "true", fix: "true" },
      message: "want.a.b must be a plain object (was Map)",
    },
    {
      description: "whose want is a record with undefined in a nested record",
      options: { want: { a: { b: undefined } }, check: "true", fix: "true" },
      message:
        "want.a.b must be a string, a number, a boolean, null, an array, a Set, or a plain object (was undefined)",
    },
    {
      description: "whose want is a record with a Map in a nested list",
      options: { want: { a: [1, new Map()] }, check: "true", fix: "true" },
      message: "want.a[1] must be a plain object (was Map)",
    },
    {
      description: "whose want is a record with undefined in a list in a list",
      options: { want: { a: [[undefined]] }, check: "true", fix: "true" },
      message:
        "want.a[0][0] must be a string, a number, a boolean, null, an array, a Set, or a plain object (was undefined)",
    },
    {
      description: "whose want is a record with NaN",
      options: { want: { a: { b: Number.NaN } }, check: "true", fix: "true" },
      message: "want.a.b must be a string, a number, a boolean, null, an array, a Set, or a plain object (was NaN)",
    },
    {
      description: "whose want is a record with a record in a nested set",
      options: { want: { a: new Set([{}]) }, check: "true", fix: "true" },
      message:
        "want.a must be a Set of strings, numbers, booleans, or null (was a Set holding an item of type 'object')",
    },
    {
      description: "whose want is a record with undefined in a nested set",
      options: { want: { a: new Set(["b", undefined]) }, check: "true", fix: "true" },
      message:
        "want.a must be a Set of strings, numbers, booleans, or null (was a Set holding an item of type 'undefined')",
    },
    {
      description: "whose want is a record with a list that holds itself",
      options: { want: createSelfHoldingList(), check: "true", fix: "true" },
      message: "want.a[0] must be a value of its own (was a list that holds it)",
    },
    {
      description: "whose want is a record that holds itself",
      options: { want: createSelfHoldingRecord(), check: "true", fix: "true" },
      message: "want.a.self must be a value of its own (was a record that holds it)",
    },
    {
      description: "whose want is a list with an item that isn't a string",
      options: { want: ["a", 1], check: "true", fix: "true" },
      message: "want[1] must be a string (was a number)",
    },
    {
      description: "whose fix is an empty command",
      options: { want: true, check: "true", fix: "" },
      message: "fix must be non-empty",
    },
    {
      description: "whose needs holds something other than step results",
      options: { needs: [undefined], want: true, check: "true", fix: "true" },
      message: "needs[0] must be an object (was undefined)",
    },
  ])("should fail a step $description", async (testCase) => {
    const { options, message } = testCase
    const { host: h } = await createSession("plan")

    expect(await ensureOrMessage(h, castInvalid(options))).toBe(
      `failed to validate the options given to 'ensure' -> ${message}`,
    )
  })

  it("should fail a step that needs a run", async () => {
    const { host: h } = await createSession("plan")
    const prune = await h.run("Prune", "true", { after: "always" })

    expect(await ensureOrMessage(h, { needs: castInvalid([prune]), want: true, check: "true", fix: "true" })).toBe(
      `failed to validate the options given to 'ensure' -> needs[0].kind must be "dir", "ensure", "file" or "link" (was "run")`,
    )
  })

  it("should fail a step with an empty name", async () => {
    const hostSession = await createSession("plan")

    await attempt(async () => hostSession.host.ensure("", { want: true, check: "true", fix: "true" }))

    expect(getFailureMessage(hostSession)).toBe("failed to validate the name given to 'ensure' -> must be non-empty")
    // Record it as the host function's failure, because the step never started, so the report has no step to show it under.
    expect(hostSession.hostRecord.failure?.kind).toBe("host fn")
  })

  it("should fail a fix that execs an empty command", async () => {
    const { host: h } = await createSession("apply")
    const result = await ensureOrMessage(h, {
      want: true,
      check: "false",
      fix: async ({ exec }) => {
        await exec("")
      },
    })

    expect(result).toBe("failed to run the fix -> failed to validate the command given to 'exec' -> must be non-empty")
  })

  it("should fail a check that inspects an empty command", async () => {
    const { host: h } = await createSession("plan")
    const result = await ensureOrMessage(h, {
      want: true,
      check: async ({ inspect }) => (await inspect("")).exitCode === 0,
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the command given to 'inspect' -> must be non-empty",
    )
  })
})

describe("h.ensure with a fix function's difference", () => {
  it("should give the fix what a command check answered, as got, and want", async () => {
    const marker = path.join(await makeTempDir(), "mode")
    const { host: h } = await createSession()
    const differences: unknown[] = []
    const result = await ensureOrMessage(h, {
      want: "production",
      check: `cat '${marker}' 2>/dev/null || echo staging`,
      fix: async ({ exec }, difference) => {
        differences.push(difference)
        await exec(`echo production > '${marker}'`)
      },
    })

    expect([result, differences]).toStrictEqual([
      { name: "Make marker", kind: "ensure", changed: true },
      [{ got: "staging", want: "production" }],
    ])
  })

  it("should give the fix what a function check returned, as got, and want", async () => {
    const marker = path.join(await makeTempDir(), "version")
    const { host: h } = await createSession()
    const differences: unknown[] = []
    await ensureOrMessage(h, {
      want: "2.0",
      check: async ({ read }) => read(`cat '${marker}' 2>/dev/null || echo 1.0`),
      fix: async ({ exec }, difference) => {
        differences.push(difference)
        await exec(`echo 2.0 > '${marker}'`)
      },
    })

    expect(differences).toStrictEqual([{ got: "1.0", want: "2.0" }])
  })

  it("should give a boolean want's fix want, for a command check", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = await createSession()
    const differences: unknown[] = []
    await ensureOrMessage(h, {
      ...options,
      fix: async ({ exec }, difference) => {
        differences.push(difference)
        await exec(`touch '${marker}'`)
      },
    })

    expect(differences).toStrictEqual([{ want: true }])
  })

  it("should give a boolean want's fix want, for a function check", async () => {
    const { host: h } = await createSession()
    const differences: unknown[] = []
    await ensureOrMessage(h, {
      want: false,
      check: async ({ read }) => (await read("echo yes")) === "yes",
      fix: async (_, difference) => {
        differences.push(difference)
        await Promise.resolve()
      },
      verify: false,
    })

    expect(differences).toStrictEqual([{ want: false }])
  })
})
