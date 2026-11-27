import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"

import { castInvalid, createSession, getFailureMessage, runOrMessage, throwBoom } from "#core/__tests__/session.ts"
import { getFinishedStepRecords } from "#core/session/recorder/records/step.ts"

const createMarker = async () => path.join(await makeTempDir(), "marker")

describe("h.run", () => {
  it("should run an always run in apply and return changed", async () => {
    const marker = await createMarker()
    const { host: h } = await createSession("apply")

    expect(await runOrMessage(h, `touch '${marker}'`, { after: "always" })).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(true)
  })

  it("should fail the host without running when after is empty", async () => {
    const marker = await createMarker()
    const hostSession = await createSession("apply")
    const message = "failed to validate the options given to 'run' -> after must be non-empty"

    expect(await runOrMessage(hostSession.host, `touch '${marker}'`, { after: [] })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should return changed in plan without running", async () => {
    const marker = await createMarker()
    const { host: h } = await createSession("plan")

    expect(await runOrMessage(h, `touch '${marker}'`, { after: "always" })).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should run after a step that changed", async () => {
    const marker = await createMarker()
    const { host: h } = await createSession("apply")
    const unchanged = await h.ensure("Stay right", { want: true, check: "true", fix: "true" })
    const changed = await h.ensure("Change", { want: true, check: "false", fix: "true", verify: false })

    expect(await runOrMessage(h, `touch '${marker}'`, { after: [unchanged, changed] })).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(true)
  })

  it("should not run after steps that were all unchanged", async () => {
    const marker = await createMarker()
    const { host: h } = await createSession("apply")
    const unchanged = await h.ensure("Stay right", { want: true, check: "true", fix: "true" })

    expect(await runOrMessage(h, `touch '${marker}'`, { after: [unchanged] })).toMatchObject({ changed: false })
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host with the run's name when the command fails", async () => {
    const hostSession = await createSession()
    const message = "failed to run the step -> exited with code 2: nope"

    expect(await runOrMessage(hostSession.host, "echo nope >&2; exit 2", { after: "always" })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })
})

/** Returns each finished step's status, by its name. */
const getStatuses = (hostSession: Awaited<ReturnType<typeof createSession>>) => {
  const { hostRecord } = hostSession
  return Object.fromEntries(getFinishedStepRecords(hostRecord).map(({ name, status }) => [name, status]))
}

describe("h.run's status", () => {
  it.each(["apply", "plan"] as const)("should mark an always run ranAlways in %s", async (mode) => {
    const hostSession = await createSession(mode)
    await hostSession.host.run("Prune", "true", { after: "always" })

    expect(getStatuses(hostSession)).toStrictEqual({ Prune: "ranAlways" })
  })

  it.each(["apply", "plan"] as const)(
    "should mark a chain of runs after an always run ranAlways in %s",
    async (mode) => {
      const hostSession = await createSession(mode)
      const prune = await hostSession.host.run("Prune", "true", { after: "always" })
      const restart = await hostSession.host.run("Restart", "true", { after: [prune] })
      await hostSession.host.run("Notify", "true", { after: [restart] })

      expect(getStatuses(hostSession)).toStrictEqual({ Prune: "ranAlways", Restart: "ranAlways", Notify: "ranAlways" })
    },
  )

  it.each(["apply", "plan"] as const)(
    "should mark a run after an always run and a step that changed ran in %s",
    async (mode) => {
      const hostSession = await createSession(mode)
      const prune = await hostSession.host.run("Prune", "true", { after: "always" })
      const changed = await hostSession.host.ensure("Change", {
        want: true,
        check: "false",
        fix: "true",
        verify: false,
      })
      await hostSession.host.run("Restart", "true", { after: [prune, changed] })

      expect(getStatuses(hostSession)).toStrictEqual({ Prune: "ranAlways", Change: "changed", Restart: "ran" })
    },
  )

  it.each(["apply", "plan"] as const)(
    "should mark a run after an always run and a step that was already right ranAlways in %s",
    async (mode) => {
      const hostSession = await createSession(mode)
      const prune = await hostSession.host.run("Prune", "true", { after: "always" })
      const unchanged = await hostSession.host.ensure("Stay right", { want: true, check: "true", fix: "true" })
      await hostSession.host.run("Restart", "true", { after: [prune, unchanged] })

      expect(getStatuses(hostSession)).toStrictEqual({
        Prune: "ranAlways",
        "Stay right": "unchanged",
        Restart: "ranAlways",
      })
    },
  )
})

describe("h.run with a function", () => {
  it("should run the commands in order", async () => {
    const file = path.join(await makeTempDir(), "lines")
    const { host: h } = await createSession()
    const result = await runOrMessage(
      h,
      async ({ exec }) => {
        await exec(`echo a >> '${file}'`)
        await exec(`echo b >> '${file}'`)
      },
      { after: "always" },
    )

    expect(result).toMatchObject({ changed: true })
    expect(await bun.file(file).text()).toBe("a\nb\n")
  })

  it("should stop at the first failed command and fail the host with the run's name", async () => {
    const marker = await createMarker()
    const hostSession = await createSession()
    const message = "failed to run the step -> failed to run 'exit 2' -> exited with code 2"
    const result = await runOrMessage(
      hostSession.host,
      async ({ exec }) => {
        await exec("exit 2")
        await exec(`touch '${marker}'`)
      },
      { after: "always" },
    )

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
    expect(await bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host with the run's name when the function throws", async () => {
    const { host: h } = await createSession()

    expect(await runOrMessage(h, throwBoom, { after: "always" })).toBe("failed to run the step -> boom")
  })

  it("should not call the function in plan", async () => {
    const marker = await createMarker()
    const { host: h } = await createSession("plan")
    const result = await runOrMessage(
      h,
      async ({ exec }) => {
        await exec(`touch '${marker}'`)
      },
      { after: "always" },
    )

    expect(result).toMatchObject({ changed: true })
    expect(await bun.file(marker).exists()).toBe(false)
  })
})

describe("h.run with invalid input", () => {
  it.each([
    {
      description: "has no after",
      options: {},
      message: 'after must be an array or "always" (was missing)',
    },
    {
      description: "has an after that holds something other than step results",
      options: { after: [undefined] },
      message: "after[0] must be an object (was undefined)",
    },
    {
      description: "follows a step that can't change the host",
      options: { after: [{ name: "uname -m", kind: "read", changed: false }] },
      message: 'after[0].kind must be "dir", "ensure", "file", "link" or "run" (was "read")',
    },
  ])("should fail a run that $description", async (testCase) => {
    const { options, message } = testCase
    const { host: h } = await createSession("plan")

    expect(await runOrMessage(h, "true", castInvalid(options))).toBe(
      `failed to validate the options given to 'run' -> ${message}`,
    )
  })

  it("should fail a run whose command is neither a string nor a function", async () => {
    const { host: h } = await createSession("plan")

    expect(await runOrMessage(h, castInvalid(1), { after: "always" })).toBe(
      "failed to validate the command given to 'run' -> must be a string or an object (was a number)",
    )
  })
})
