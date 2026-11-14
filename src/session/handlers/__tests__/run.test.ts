import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"

import { castInvalid, createSession, getFailureMessage, runOrMessage, throwBoom } from "#__tests__/session.ts"

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
      message: 'after[0].kind must be "ensure", "file", "link" or "run" (was "read")',
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
