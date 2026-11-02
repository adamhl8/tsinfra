import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt } from "ts-explicit-errors"

import { createSession, ensureOrMessage, getFailureMessage, throwBoom } from "#__tests__/session.ts"

// Widen `want` to the union, which lets a mismatched check through the types, as an untyped host file would.
const toLooseWant = (value: string | boolean) => value

/** Returns a path in a new temp dir, plus a step that creates a file there. */
const createMarkerStep = async () => {
  const marker = path.join(await makeTempDir("step-"), "marker")
  return { marker, options: { check: `test -f '${marker}'`, want: true, fix: `touch '${marker}'` } }
}

describe("h.ensure", () => {
  it("should return unchanged without running the fix when the check passes", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "true", want: true, fix: "exit 1" })).toMatchObject({ changed: false })
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

    expect(await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "echo nope >&2; exit 2" })).toBe(
      message,
    )
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when the host's state still differs after the fix", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "false", want: true, fix: "true" })).toBe(
      "the host's state still differs after the fix for step 'Make marker'",
    )
  })

  it("should accept a function check that uses the given read", async () => {
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ read }) => (await read("echo yes")) === "yes",
      want: true,
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should return unchanged when want is false and the check exits non-zero", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "false", want: false, fix: "exit 1" })).toMatchObject({ changed: false })
  })

  it("should run the fix when want is false and the check exits 0", async () => {
    const { marker } = await createMarkerStep()
    await Bun.write(marker, "")
    const { host: h } = createSession()

    expect(
      await ensureOrMessage(h, { check: `test -f '${marker}'`, want: false, fix: `rm '${marker}'` }),
    ).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should compare the boolean a function check returns to want", async () => {
    const { host: h } = createSession()

    const result = await ensureOrMessage(h, {
      check: async ({ read }) => (await read("echo no")) === "yes",
      want: false,
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should fail when a function check returns a different type than want", async () => {
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ read }) => (await read("echo active")) === "active",
      want: toLooseWant("active"),
      fix: "true",
    })

    expect(result).toBe(
      "failed to read the host's state for step 'Make marker' -> the check returned a boolean, but want is a string",
    )
  })

  it("should fail the host with the step's name when a function check throws", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: throwBoom, want: true, fix: "true" })).toBe(
      "failed to read the host's state for step 'Make marker' -> boom",
    )
  })

  it("should name the step when a read inside a function check fails", async () => {
    const hostSession = createSession()
    const message =
      "failed to read the host's state for step 'Make marker' -> failed to read 'exit 1' -> exited with code 1"
    const result = await ensureOrMessage(hostSession.host, {
      check: async ({ read }) => (await read("exit 1")) === "",
      want: true,
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
      want: true,
      fix: "true",
    })

    expect(result).toBe("failed to read 'exit 1' -> exited with code 1")
  })
})

/** Returns a path in a new temp dir, plus a step that writes `value` there. */
const createValueStep = async (value: string) => {
  const file = path.join(await makeTempDir("step-"), "value")
  return {
    file,
    options: { check: `cat '${file}' 2>/dev/null`, want: value, fix: `printf '%s\\n' '${value}' > '${file}'` },
  }
}

describe("h.ensure with a string want", () => {
  it("should return unchanged without running the fix when the output matches", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "echo v2", want: "v2", fix: "exit 1" })).toMatchObject({
      changed: false,
    })
  })

  it("should ignore trailing newlines on both sides", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: String.raw`printf 'v2\n\n'`, want: "v2\n", fix: "exit 1" })).toMatchObject(
      { changed: false },
    )
  })

  it("should return changed in plan without running the fix", async () => {
    const { file, options } = await createValueStep("v2")
    const { host: h } = createSession("plan")

    expect(await ensureOrMessage(h, options)).toMatchObject({ changed: true })
    expect(await Bun.file(file).exists()).toBe(false)
  })

  it("should run the fix in apply and return changed", async () => {
    const { file, options } = await createValueStep("v2")
    const { host: h } = createSession("apply")

    expect(await ensureOrMessage(h, options)).toMatchObject({ changed: true })
    expect(await Bun.file(file).text()).toBe("v2\n")
  })

  it("should fail a check that exits non-zero but matches want", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "echo v2; echo broken >&2; exit 1", want: "v2", fix: "true" })).toBe(
      "failed to read the host's state for step 'Make marker' -> exited with code 1: broken",
    )
  })

  it("should treat a check that exits non-zero with other output as a mismatch", async () => {
    const { host: h } = createSession("plan")

    expect(await ensureOrMessage(h, { check: "echo inactive; exit 3", want: "active", fix: "true" })).toMatchObject({
      changed: true,
    })
  })

  it("should compare the string a function check returns", async () => {
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ read }) => (await read("echo V2")).toLowerCase(),
      want: "v2",
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })
})

describe("h.ensure with verify: false", () => {
  it("should return changed without checking again after the fix", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "false", want: true, fix: "true", verify: false })).toMatchObject({
      changed: true,
    })
  })

  it("should still fail the host when the fix fails", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "false", want: true, fix: "exit 2", verify: false })).toBe(
      "failed to run the fix for step 'Make marker' -> exited with code 2",
    )
  })
})

describe("h.ensure with the inspect tool", () => {
  it("should treat a missing file as a needed fix in a check function", async () => {
    const { marker } = await createMarkerStep()
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ inspect }) => (await inspect(`cat '${marker}'`)).exitCode === 0,
      want: true,
      fix: `touch '${marker}'`,
    })

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(true)
  })

  it("should give a fix function the exit code of a command", async () => {
    const { marker, options } = await createMarkerStep()
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      ...options,
      fix: async ({ exec, inspect }) => {
        const { exitCode } = await inspect("exit 4")
        await exec(`printf '%s' '${exitCode}' > '${marker}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(marker).text()).toBe("4")
  })
})

describe("h.ensure with a fix function", () => {
  it("should run the commands in order and return changed", async () => {
    const file = path.join(await makeTempDir("step-"), "lines")
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: `test -s '${file}'`,
      want: true,
      fix: async ({ exec }) => {
        await exec(`echo a >> '${file}'`)
        await exec(`echo b >> '${file}'`)
      },
    })

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(file).text()).toBe("a\nb\n")
  })

  it("should return each command's stdout trimmed", async () => {
    const file = path.join(await makeTempDir("step-"), "value")
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: `test -f '${file}'`,
      want: true,
      fix: async ({ exec }) => {
        const value = await exec(String.raw`printf '  v\n\n'`)
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

    expect(await ensureOrMessage(h, { check: "false", want: true, fix: throwBoom })).toBe(
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
