import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import {
  castInvalid,
  createSession,
  ensureOrMessage,
  getFailureMessage,
  getStepRecords,
  readOrMessage,
} from "#core/__tests__/session.ts"
import { getFinishedStepRecords } from "#core/recorder/records/step.ts"

describe("h.log", () => {
  it("should record a message logged outside a step as an entry between the steps around it", async () => {
    const hostSession = await createSession()
    const { host: h } = hostSession

    await h.read("echo one")
    h.log.info("between")
    h.log.warn("still between")
    await h.read("echo two")

    expect(hostSession.hostRecord.entries).toMatchObject([
      { kind: "read", name: "echo one" },
      { kind: "hostMessage", messageKind: "info", text: "between" },
      { kind: "hostMessage", messageKind: "warn", text: "still between" },
      { kind: "read", name: "echo two" },
    ])
  })

  it("should record a message a check logs on its step, with its phase and the commands before it", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession

    await h.ensure("Check", {
      want: true,
      check: async ({ read }) => {
        await read("echo a")
        h.log.info("between")
        await read("echo b")
        return true
      },
      fix: "true",
    })

    expect(hostSession.hostRecord.entries).toHaveLength(1)
    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.messages).toStrictEqual([
      { messageKind: "info", text: "between", phase: "before", commandCount: 1 },
    ])
  })

  it("should record what each phase logs in apply, so a check logs once before the fix and once after", async () => {
    const marker = path.join(await makeTempDir(), "marker")
    const hostSession = await createSession("apply")
    const { host: h } = hostSession

    await h.ensure("Make marker", {
      want: true,
      check: async ({ inspect }) => {
        const { exitCode } = await inspect(`test -e '${marker}'`)
        h.log.info(`exists: ${String(exitCode === 0)}`)
        return exitCode === 0
      },
      fix: async ({ exec }) => {
        h.log.warn("making it")
        await exec(`touch '${marker}'`)
      },
    })

    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.messages).toStrictEqual([
      { messageKind: "info", text: "exists: false", phase: "before", commandCount: 1 },
      { messageKind: "warn", text: "making it", phase: "fix", commandCount: 1 },
      { messageKind: "info", text: "exists: true", phase: "after", commandCount: 3 },
    ])
  })

  it("should record a message a run's function logs with no phase", async () => {
    const hostSession = await createSession("apply")
    const { host: h } = hostSession

    await h.run(
      "Follow up",
      async ({ exec }) => {
        await exec("true")
        h.log.info("ran")
      },
      { after: "always" },
    )

    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.messages).toStrictEqual([
      { messageKind: "info", text: "ran", phase: undefined, commandCount: 1 },
    ])
  })

  it("should keep the messages a step logged before it failed", async () => {
    const hostSession = await createSession("apply")
    const { host: h } = hostSession

    await ensureOrMessage(h, {
      want: true,
      check: async ({ read }) => {
        h.log.warn("about to fail")
        return (await read("echo no")) === "yes"
      },
      fix: "exit 1",
    })

    expect(hostSession.hostRecord.failure?.kind).toBe("step")
    expect(getStepRecords(hostSession.hostRecord)[0]?.messages).toMatchObject([{ text: "about to fail" }])
  })

  it("should mask a secret in a message, in a step and after it", async () => {
    const hostSession = await createSession("apply")
    const { host: h } = hostSession

    await h.ensure("Use the token", {
      want: true,
      secretEnv: { TOKEN: "s3cret" },
      check: async ({ read }) => {
        h.log.info("the token is s3cret")
        return (await read("echo yes")) === "yes"
      },
      fix: "true",
    })
    h.log.info("still s3cret")

    const { entries } = hostSession.hostRecord
    expect(getFinishedStepRecords(hostSession.hostRecord)[0]?.messages).toMatchObject([
      { text: "the token is [MASKED]" },
    ])
    expect(entries.at(-1)).toStrictEqual({ kind: "hostMessage", messageKind: "info", text: "still [MASKED]" })
  })

  it.each([
    ["a number", 1, "must be a string (was a number)"],
    ["an empty string", "", "must be non-empty"],
  ])("should fail the host and throw when the message is %s", async (_, message, reason) => {
    const hostSession = await createSession()
    const failureMessage = `failed to validate the message given to 'log.info' -> ${reason}`

    expect(() => {
      hostSession.host.log.info(castInvalid(message))
    }).toThrow("failed to validate the message given to 'log.info'")
    expect(getFailureMessage(hostSession)).toBe(failureMessage)
    expect(hostSession.hostRecord.failure?.kind).toBe("host fn")
    expect(hostSession.hostRecord.entries).toStrictEqual([])
  })

  it("should fail the step whose function logs a message that isn't a string", async () => {
    const hostSession = await createSession()
    const { host: h } = hostSession

    await ensureOrMessage(h, {
      want: true,
      check: async ({ read }) => {
        h.log.warn(castInvalid(1))
        return (await read("echo yes")) === "yes"
      },
      fix: "true",
    })

    expect(hostSession.hostRecord.failure).toMatchObject({ kind: "step", stepRecord: { name: "Make marker" } })
    expect(getFailureMessage(hostSession)).toContain("failed to validate the message given to 'log.warn'")
  })

  it("should throw the host's failure and record nothing once the host has failed", async () => {
    const hostSession = await createSession()
    await readOrMessage(hostSession.host, "exit 1")

    expect(() => {
      hostSession.host.log.info("too late")
    }).toThrow("failed to read 'exit 1'")
    expect(hostSession.hostRecord.entries).toStrictEqual([])
  })
})
