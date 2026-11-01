import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import { createSession, getFailureMessage, runOrMessage, throwBoom } from "#__tests__/session.ts"

const createMarker = async () => path.join(await makeTempDir("run-"), "marker")

describe("h.run", () => {
  it("should run the command in apply when `when` is true and return changed", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("apply")

    expect(await runOrMessage(h, `touch '${marker}'`, { when: true })).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(true)
  })

  it("should return unchanged without running when `when` is false", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("apply")

    expect(await runOrMessage(h, `touch '${marker}'`, { when: false })).toMatchObject({ changed: false })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should return changed in plan without running", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("plan")

    expect(await runOrMessage(h, `touch '${marker}'`, { when: true })).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host with the run's name when the command fails", async () => {
    const hostSession = createSession()
    const message = "failed to run step 'Make marker' -> exited with code 2: nope"

    expect(await runOrMessage(hostSession.host, "echo nope >&2; exit 2", { when: true })).toBe(message)
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
      { when: true },
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
      { when: true },
    )

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  it("should fail the host with the run's name when the function throws", async () => {
    const { host: h } = createSession()

    expect(await runOrMessage(h, throwBoom, { when: true })).toBe("failed to run step 'Make marker' -> boom")
  })

  it("should not call the function in plan", async () => {
    const marker = await createMarker()
    const { host: h } = createSession("plan")
    const result = await runOrMessage(
      h,
      async ({ exec }) => {
        await exec(`touch '${marker}'`)
      },
      { when: true },
    )

    expect(result).toMatchObject({ changed: true })
    expect(await Bun.file(marker).exists()).toBe(false)
  })
})
