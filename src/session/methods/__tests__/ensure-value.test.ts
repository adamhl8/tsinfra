import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import { createSession, ensureValueOrMessage, throwBoom } from "#__tests__/session.ts"

/** Returns a path in a new temp dir, plus a read step that writes `value` there. */
const createValueStep = async (value: string) => {
  const file = path.join(await makeTempDir("step-"), "value")
  return {
    file,
    options: { read: `cat '${file}' 2>/dev/null`, want: value, fix: `printf '%s\\n' '${value}' > '${file}'` },
  }
}

describe("h.ensureValue", () => {
  it("should return ok without running the fix when the output matches", async () => {
    const { host: h } = createSession()

    expect(await ensureValueOrMessage(h, { read: "echo v2", want: "v2", fix: "exit 1" })).toStrictEqual({
      changed: false,
    })
  })

  it("should ignore trailing newlines on both sides", async () => {
    const { host: h } = createSession()

    expect(
      await ensureValueOrMessage(h, { read: String.raw`printf 'v2\n\n'`, want: "v2\n", fix: "exit 1" }),
    ).toStrictEqual({
      changed: false,
    })
  })

  it("should return changed in plan without running the fix", async () => {
    const { file, options } = await createValueStep("v2")
    const { host: h } = createSession("plan")

    expect(await ensureValueOrMessage(h, options)).toStrictEqual({ changed: true })
    expect(await Bun.file(file).exists()).toBe(false)
  })

  it("should run the fix in apply and return changed", async () => {
    const { file, options } = await createValueStep("v2")
    const { host: h } = createSession("apply")

    expect(await ensureValueOrMessage(h, options)).toStrictEqual({ changed: true })
    expect(await Bun.file(file).text()).toBe("v2\n")
  })

  it("should show both values when the output still differs after the fix", async () => {
    const { host: h } = createSession()

    expect(await ensureValueOrMessage(h, { read: "echo v1", want: "v2", fix: "true" })).toBe(
      "the check for step 'Make marker' still fails after the fix\n  read: v1\n  want: v2",
    )
  })

  it("should show the exit error when a read that exits non-zero still differs after the fix", async () => {
    const { host: h } = createSession()

    expect(await ensureValueOrMessage(h, { read: "echo v1; echo oops >&2; exit 3", want: "v2", fix: "true" })).toBe(
      "the check for step 'Make marker' still fails after the fix\n  read: v1\n  want: v2\n  exited with code 3: oops",
    )
  })

  it("should fail a read that exits non-zero but matches want", async () => {
    const { host: h } = createSession()

    expect(await ensureValueOrMessage(h, { read: "echo v2; echo broken >&2; exit 1", want: "v2", fix: "true" })).toBe(
      "failed to check step 'Make marker' -> exited with code 1: broken",
    )
  })

  it("should treat a read that exits non-zero with other output as a mismatch", async () => {
    const { host: h } = createSession("plan")

    expect(await ensureValueOrMessage(h, { read: "echo inactive; exit 3", want: "active", fix: "true" })).toStrictEqual(
      {
        changed: true,
      },
    )
  })

  it("should accept a function read that uses h.read", async () => {
    const { host: h } = createSession()
    const read = async () => (await h.read("echo V2")).toLowerCase()

    expect(await ensureValueOrMessage(h, { read, want: "v2", fix: "exit 1" })).toStrictEqual({ changed: false })
  })

  it("should fail the host with the step's name when a function read throws", async () => {
    const { host: h } = createSession()

    expect(await ensureValueOrMessage(h, { read: throwBoom, want: "v2", fix: "true" })).toBe(
      "failed to check step 'Make marker' -> boom",
    )
  })
})
