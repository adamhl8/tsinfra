import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import { createSession, getFailureMessage, runOrMessage, throwBoom } from "#__tests__/session.ts"

const createMarker = async () => path.join(await makeTempDir("run-"), "marker")

describe("h.run", () => {
  it("should run an always run in apply and return changed", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("apply")

    expect(await runOrMessage(h, `touch '${marker}'`, { after: "always" })).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(true)
  })

  it("should fail the host without running when after is empty", async () => {
    const marker = await createMarker()
    const hostSession = createSession("apply")
    const message = "failed to run step 'Make marker' -> after must be non-empty"

    expect(await runOrMessage(hostSession.host, `touch '${marker}'`, { after: [] })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should return changed in plan without running", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("plan")

    expect(await runOrMessage(h, `touch '${marker}'`, { after: "always" })).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should run after a step that changed", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("apply")
    const unchanged = await h.ensure("Stay right", { check: "true", want: true, fix: "true" })
    const changed = await h.ensure("Change", { check: "false", want: true, fix: "true", verify: false })

    expect(await runOrMessage(h, `touch '${marker}'`, { after: [unchanged, changed] })).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(true)
  })

  it("should not run after steps that were all unchanged", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("apply")
    const unchanged = await h.ensure("Stay right", { check: "true", want: true, fix: "true" })

    expect(await runOrMessage(h, `touch '${marker}'`, { after: [unchanged] })).toMatchObject({ changed: false })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host with the run's name when the command fails", async () => {
    const hostSession = createSession()
    const message = "failed to run step 'Make marker' -> exited with code 2: nope"

    expect(await runOrMessage(hostSession.host, "echo nope >&2; exit 2", { after: "always" })).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })
})

describe("h.run with a function", () => {
  it("should run the commands in order", async () => {
    const file = path.join(await makeTempDir("run-"), "lines")
    const { host: h } = createSession()
    const result = await runOrMessage(
      h,
      async ({ exec }) => {
        await exec(`echo a >> '${file}'`)
        await exec(`echo b >> '${file}'`)
      },
      { after: "always" },
    )

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(file).text()).toBe("a\nb\n")
  })

  it("should stop at the first failed command and fail the host with the run's name", async () => {
    const marker = await createMarker()
    const hostSession = createSession()
    const message = "failed to run step 'Make marker' -> failed to run 'exit 2' -> exited with code 2"
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
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host with the run's name when the function throws", async () => {
    const { host: h } = createSession()

    expect(await runOrMessage(h, throwBoom, { after: "always" })).toBe("failed to run step 'Make marker' -> boom")
  })

  it("should not call the function in plan", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("plan")
    const result = await runOrMessage(
      h,
      async ({ exec }) => {
        await exec(`touch '${marker}'`)
      },
      { after: "always" },
    )

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })
})
