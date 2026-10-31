import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt } from "ts-explicit-errors"

import { createSession, ensureOrMessage, getFailureMessage, throwBoom } from "#__tests__/session.ts"

/** Returns a path in a new temp dir, plus a step that creates a file there. */
const createMarkerStep = async () => {
  const marker = path.join(await makeTempDir("step-"), "marker")
  return { marker, options: { check: `test -f '${marker}'`, fix: `touch '${marker}'` } }
}

describe("h.ensure", () => {
  it("should return ok without running the fix when the check passes", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "true", fix: "exit 1" })).toMatchObject({ changed: false })
  })

  it("should run the fix in apply and return changed", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = createSession("apply")

    expect(await ensureOrMessage(h, options)).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(true)
  })

  it("should return changed in plan without running the fix", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = createSession("plan")

    expect(await ensureOrMessage(h, options)).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host when the fix fails", async () => {
    const hostSession = createSession()
    const message = "failed to run the fix for step 'Make marker' -> exited with code 2: nope"

    expect(await ensureOrMessage(hostSession.host, { check: "false", fix: "echo nope >&2; exit 2" })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when the check still fails after the fix", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "echo missing >&2; false", fix: "true" })).toBe(
      "the check for step 'Make marker' still fails after the fix\n  exited with code 1: missing",
    )
  })

  it("should accept a function check that uses the given read", async () => {
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ read }) => (await read("echo yes")) === "yes",
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should fail the host with the step's name when a function check throws", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: throwBoom, fix: "true" })).toBe(
      "failed to check step 'Make marker' -> boom",
    )
  })

  it("should name the step when a read inside a function check fails", async () => {
    const hostSession = createSession()
    const message = "failed to check step 'Make marker' -> failed to read 'exit 1' -> exited with code 1"
    const result = await ensureOrMessage(hostSession.host, {
      check: async ({ read }) => (await read("exit 1")) === "",
      fix: "true",
    })

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the step when a function check catches a failed read", async () => {
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ read }) => {
        await attempt(async () => read("exit 1"))
        return true
      },
      fix: "true",
    })

    expect(result).toBe("failed to read 'exit 1' -> exited with code 1")
  })
})

describe("h.ensure with verify: false", () => {
  it("should return changed without checking again after the fix", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "false", fix: "true", verify: false })).toMatchObject({ changed: true })
  })

  it("should still fail the host when the fix fails", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "false", fix: "exit 2", verify: false })).toBe(
      "failed to run the fix for step 'Make marker' -> exited with code 2",
    )
  })
})

describe("h.ensure with a fix function", () => {
  it("should run the commands in order and return changed", async () => {
    const file = path.join(await makeTempDir("step-"), "lines")
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: `test -s '${file}'`,
      fix: async ({ exec }) => {
        await exec(`echo a >> '${file}'`)
        await exec(`echo b >> '${file}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(file).text()).toBe("a\nb\n")
  })

  it("should return each command's stdout without trailing newlines", async () => {
    const file = path.join(await makeTempDir("step-"), "value")
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: `test -f '${file}'`,
      fix: async ({ exec }) => {
        const value = await exec(String.raw`printf 'v\n\n'`)
        await exec(`printf '%s' '${value}' > '${file}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(file).text()).toBe("v")
  })

  it("should stop at the first failed command and fail the host with the step's name", async () => {
    const { marker, options } = await createMarkerStep()
    const hostSession = createSession()
    const message =
      "failed to run the fix for step 'Make marker' -> failed to run 'echo nope >&2; exit 2' -> exited with code 2: nope"
    const result = await ensureOrMessage(hostSession.host, {
      ...options,
      fix: async ({ exec }) => {
        await exec("echo nope >&2; exit 2")
        await exec(`touch '${marker}'`)
      },
    })

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should fail the step when the fix function catches a failed command", async () => {
    const { marker, options } = await createMarkerStep()
    const cmd = `touch '${marker}'; exit 1`
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      ...options,
      fix: async ({ exec }) => {
        await attempt(async () => exec(cmd))
      },
    })

    expect(result).toBe(`failed to run '${cmd}' -> exited with code 1`)
  })

  it("should fail the host with the step's name when the fix function throws", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "false", fix: throwBoom })).toBe(
      "failed to run the fix for step 'Make marker' -> boom",
    )
  })

  it("should not call the fix function in plan", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = createSession("plan")
    const result = await ensureOrMessage(h, {
      ...options,
      fix: async ({ exec }) => {
        await exec(`touch '${marker}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })
})
