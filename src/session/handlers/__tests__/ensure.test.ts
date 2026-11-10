import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import { attempt } from "ts-explicit-errors"

import { castInvalid, createSession, ensureOrMessage, getFailureMessage, throwBoom } from "#__tests__/session.ts"
import type { Want } from "#session/handlers/ensure/check.ts"
import type { ChangeTools } from "#session/handlers/tools.ts"

// Widen `want` to the union, which lets a mismatched check through the types, as an untyped host script would.
const toLooseWant = (value: Want) => value

/** Returns a path in a new temp dir, plus a step that creates a file there. */
const createMarkerStep = async () => {
  const marker = path.join(await makeTempDir(), "marker")
  return { marker, options: { check: `test -f '${marker}'`, want: true, fix: `touch '${marker}'` } }
}

describe("h.ensure", () => {
  it("should return unchanged without running the fix when the check passes", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: "true", want: true, fix: "exit 1" })).toMatchObject({ changed: false })
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

    expect(await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "echo nope >&2; exit 2" })).toBe(
      message,
    )
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when the host's state still differs after the fix", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: "false", want: true, fix: "true" })).toBe(
      "the host's state still differs after the fix",
    )
  })

  it("should accept a function check that uses the given read", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ read }) => (await read("echo yes")) === "yes",
      want: true,
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should return unchanged when want is false and the check exits non-zero", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: "false", want: false, fix: "exit 1" })).toMatchObject({ changed: false })
  })

  it("should run the fix when want is false and the check exits 0", async () => {
    const { marker } = await createMarkerStep()
    await bun.write(marker, "")
    const { host: h } = await createSession()

    expect(
      await ensureOrMessage(h, { check: `test -f '${marker}'`, want: false, fix: `rm '${marker}'` }),
    ).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should compare the boolean a function check returns to want", async () => {
    const { host: h } = await createSession()

    const result = await ensureOrMessage(h, {
      check: async ({ read }) => (await read("echo no")) === "yes",
      want: false,
      fix: "exit 1",
    })

    expect(result).toMatchObject({ changed: false })
  })

  it("should fail validation when a function check returns a different type than want", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ read }) => (await read("echo active")) === "active",
      want: toLooseWant("active"),
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> it's of type boolean, but want is of type string",
    )
  })

  it("should fail the host with the step's name when a function check throws", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: throwBoom, want: true, fix: "true" })).toBe(
      "failed to compare the host with what the step wants -> boom",
    )
  })

  it("should validate an Error a function check returns as a value, not a thrown error", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      check: castInvalid(() => new Error("returned")),
      want: true,
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the value the check returned -> it's of type object, but want is of type boolean",
    )
  })

  it("should name the step when a read inside a function check fails", async () => {
    const hostSession = await createSession()
    const message =
      "failed to compare the host with what the step wants -> failed to read 'exit 1' -> exited with code 1"
    const result = await ensureOrMessage(hostSession.host, {
      check: async ({ read }) => (await read("exit 1")) === "",
      want: true,
      fix: "true",
    })

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the step when a function check catches a failed read", async () => {
    const { host: h } = await createSession()
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
  const file = path.join(await makeTempDir(), "value")
  return {
    file,
    options: { check: `cat '${file}' 2>/dev/null`, want: value, fix: `printf '%s\\n' '${value}' > '${file}'` },
  }
}

describe("h.ensure with a string want", () => {
  it("should return unchanged without running the fix when the output matches", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: "echo v2", want: "v2", fix: "exit 1" })).toMatchObject({
      changed: false,
    })
  })

  it("should ignore trailing newlines on both sides", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: String.raw`printf 'v2\n\n'`, want: "v2\n", fix: "exit 1" })).toMatchObject(
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

    expect(await ensureOrMessage(h, { check: "echo v2; echo broken >&2; exit 1", want: "v2", fix: "true" })).toBe(
      "failed to compare the host with what the step wants -> exited with code 1: broken",
    )
  })

  it("should treat a check that exits non-zero with other output as a mismatch", async () => {
    const { host: h } = await createSession("plan")

    expect(await ensureOrMessage(h, { check: "echo inactive; exit 3", want: "active", fix: "true" })).toMatchObject({
      changed: true,
    })
  })

  it("should compare the string a function check returns", async () => {
    const { host: h } = await createSession()
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
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: "false", want: true, fix: "true", verify: false })).toMatchObject({
      changed: true,
    })
  })

  it("should still fail the host when the fix fails", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: "false", want: true, fix: "exit 2", verify: false })).toBe(
      "failed to run the fix -> exited with code 2",
    )
  })
})

describe("h.ensure with needs", () => {
  it("should wait in plan without checking when a needed step would change", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { check: "false", want: true, fix: "true" })
    const result = await h.ensure("Install fish plugins", { needs: [brew], check: "exit 1", want: true, fix: "true" })

    expect(result).toStrictEqual({ name: "Install fish plugins", kind: "ensure", changed: true })
    expect(hostSession.hostRecord.stepRecords[1]).toMatchObject({
      status: "waiting",
      waitingOn: ["Install brew packages"],
      commands: [],
    })
  })

  it("should check as usual in plan when every needed step is unchanged", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { check: "true", want: true, fix: "true" })
    await h.ensure("Install fish plugins", { needs: [brew], check: "false", want: true, fix: "true" })

    expect(hostSession.hostRecord.stepRecords[1]?.status).toBe("changed")
  })

  it("should check as usual in plan when needs is empty", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    await h.ensure("Install fish plugins", { needs: [], check: "false", want: true, fix: "true" })

    expect(hostSession.hostRecord.stepRecords[0]?.status).toBe("changed")
  })

  it("should wait on a needed step that is itself waiting, and name it", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { check: "false", want: true, fix: "true" })
    const fish = await h.ensure("Install fish", { needs: [brew], check: "true", want: true, fix: "true" })
    await h.ensure("Install fish plugins", { needs: [fish], check: "true", want: true, fix: "true" })

    expect(hostSession.hostRecord.stepRecords[2]).toMatchObject({ status: "waiting", waitingOn: ["Install fish"] })
  })

  it("should ignore needs in apply", async () => {
    const hostSession = await createSession("apply")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { check: "false", want: true, fix: "true", verify: false })
    await h.ensure("Install fish plugins", { needs: [brew], check: "true", want: true, fix: "true" })

    expect(hostSession.hostRecord.stepRecords[1]).toMatchObject({ status: "unchanged", commands: [{ cmd: "true" }] })
  })
})

describe("h.ensure with the inspect tool", () => {
  it("should treat a missing file as a needed fix in a check function", async () => {
    const { marker } = await createMarkerStep()
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      check: async ({ inspect }) => (await inspect(`cat '${marker}'`)).exitCode === 0,
      want: true,
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
      check: `test -s '${file}'`,
      want: true,
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
      check: `test -f '${file}'`,
      want: true,
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

    expect(await ensureOrMessage(h, { check: "false", want: true, fix: throwBoom })).toBe(
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

describe("h.ensure with invalid input", () => {
  it.each([
    {
      description: "whose want is neither a string nor a boolean",
      options: { check: "true", want: 1, fix: "true" },
      message: "want must be a string or boolean (was a number)",
    },
    {
      description: "whose fix is an empty command",
      options: { check: "true", want: true, fix: "" },
      message: "fix must be non-empty",
    },
    {
      description: "whose needs holds something other than step results",
      options: { needs: [undefined], check: "true", want: true, fix: "true" },
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

    expect(await ensureOrMessage(h, { needs: castInvalid([prune]), check: "true", want: true, fix: "true" })).toBe(
      `failed to validate the options given to 'ensure' -> needs[0].kind must be "ensure", "file" or "link" (was "run")`,
    )
  })

  it("should fail a step with an empty name", async () => {
    const hostSession = await createSession("plan")

    await attempt(async () => hostSession.host.ensure("", { check: "true", want: true, fix: "true" }))

    expect(getFailureMessage(hostSession)).toBe("failed to validate the name given to 'ensure' -> must be non-empty")
    // Record it as the host function's failure, because the step never started, so the report has no step to show it under.
    expect(hostSession.hostRecord.failure?.kind).toBe("host fn")
  })

  it("should fail a fix that execs an empty command", async () => {
    const { host: h } = await createSession("apply")
    const result = await ensureOrMessage(h, {
      check: "false",
      want: true,
      fix: async ({ exec }) => {
        await exec("")
      },
    })

    expect(result).toBe("failed to run the fix -> failed to validate the command given to 'exec' -> must be non-empty")
  })

  it("should fail a check that inspects an empty command", async () => {
    const { host: h } = await createSession("plan")
    const result = await ensureOrMessage(h, {
      check: async ({ inspect }) => (await inspect("")).exitCode === 0,
      want: true,
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> failed to validate the command given to 'inspect' -> must be non-empty",
    )
  })
})
