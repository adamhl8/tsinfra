import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import type { Result } from "ts-explicit-errors"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { createSession, ensureOrMessage, getFailureMessage, readOrMessage, runOrMessage } from "#__tests__/session.ts"
import type { StepRecord } from "#session/step-records.ts"

const toPlainResult = <T>(result: Result<T> | undefined) => (isErr(result) ? messageChain(result) : result)

/** Turns records into plain values to compare, with each error as its message chain and each command as its text. */
const toPlainRecords = (stepRecords: StepRecord[]) =>
  stepRecords.map(({ kind, name, commands, details }) => ({
    kind,
    name,
    details: toPlainResult(details),
    commands: commands.map(({ cmd }) => cmd),
  }))

describe("createHostSession", () => {
  it("should throw the first failure again without running anything once the host has failed", async () => {
    const file = path.join(await makeTempDir("read-"), "ran")
    const hostSession = createSession()
    await readOrMessage(hostSession.host, "exit 1")

    expect(await readOrMessage(hostSession.host, `touch '${file}'`)).toBe(
      "failed to read 'exit 1' -> exited with code 1",
    )
    expect(await Bun.file(file).exists()).toBe(false)
  })

  it("should keep the first failure when a later one doesn't wrap it", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession

    await Promise.allSettled([
      h.ensure("First", { check: "sleep 0.1; false", want: true, fix: "exit 1" }),
      h.ensure("Second", { check: "true", want: true, fix: "true" }),
    ])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while step 'First' is running")
  })

  it("should fail when the target isn't '@local'", async () => {
    const hostSession = createSession("apply", "a.lan")

    expect(await readOrMessage(hostSession.host, "echo hi")).toBe(
      "failed to read 'echo hi' -> target 'a.lan' isn't supported yet (only '@local')",
    )
  })
})

describe("h inside a step", () => {
  it("should fail the host when a check function calls h.read", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession
    const message =
      "failed to read the host's state for step 'Make marker' -> 'read' can't run while step 'Make marker' is running"
    const result = await ensureOrMessage(h, {
      check: async () => (await h.read("true")) === "",
      want: true,
      fix: "true",
    })

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when a check function calls h.ensure", async () => {
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: async () => {
        await h.ensure("Inner", { check: "echo v", want: "v", fix: "true" })
        return "v"
      },
      want: "v",
      fix: "true",
    })

    expect(result).toBe(
      "failed to read the host's state for step 'Make marker' -> 'ensure' can't run while step 'Make marker' is running",
    )
  })

  it("should fail the host when a fix function calls h.ensure", async () => {
    const { host: h } = createSession()
    const result = await ensureOrMessage(h, {
      check: "false",
      want: true,
      fix: async () => {
        await h.ensure("Inner", { check: "true", want: true, fix: "true" })
      },
    })

    expect(result).toBe(
      "failed to run the fix for step 'Make marker' -> 'ensure' can't run while step 'Make marker' is running",
    )
  })

  it("should fail the host when a run function calls h.run", async () => {
    const { host: h } = createSession()
    const result = await runOrMessage(
      h,
      async () => {
        await h.run("Inner", "true", { when: true })
      },
      { when: true },
    )

    expect(result).toBe("failed to run step 'Make marker' -> 'run' can't run while step 'Make marker' is running")
  })

  it("should fail the host when steps run at once with Promise.all", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession

    await Promise.allSettled([
      h.ensure("First", { check: "sleep 0.1", want: true, fix: "true" }),
      h.ensure("Second", { check: "true", want: true, fix: "true" }),
    ])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while step 'First' is running")
  })

  it("should name a running read by its command", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession

    await Promise.allSettled([h.read("sleep 0.1"), h.ensure("Second", { check: "true", want: true, fix: "true" })])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while read 'sleep 0.1' is running")
  })

  it("should fail the host when h.read runs alongside a step", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession

    await Promise.allSettled([h.ensure("First", { check: "sleep 0.1", want: true, fix: "true" }), h.read("true")])

    expect(getFailureMessage(hostSession)).toBe("'read' can't run while step 'First' is running")
  })

  it("should allow calls on h again once a step finishes", async () => {
    const { host: h } = createSession()

    expect(await ensureOrMessage(h, { check: "true", want: true, fix: "true" })).toMatchObject({ changed: false })
    expect(await ensureOrMessage(h, { check: "true", want: true, fix: "true" })).toMatchObject({ changed: false })
    expect(await readOrMessage(h, "echo hi")).toBe("hi")
  })
})

describe("step records", () => {
  it("should record an ensure's check, fix, and second check in apply", async () => {
    const marker = path.join(await makeTempDir("record-"), "marker")
    const hostSession = createSession("apply")
    await ensureOrMessage(hostSession.host, { check: `test -f '${marker}'`, want: true, fix: `touch '${marker}'` })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        kind: "ensure",
        name: "Make marker",
        details: {
          status: "changed",
          changed: true,
          comparison: { kind: "exit", got: 1, want: true },
        },
        commands: [`test -f '${marker}'`, `touch '${marker}'`, `test -f '${marker}'`],
      },
    ])
  })

  it("should record only the check in plan", async () => {
    const hostSession = createSession("plan")
    await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "true" })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        kind: "ensure",
        name: "Make marker",
        details: { status: "changed", changed: true, comparison: { kind: "exit", got: 1, want: true } },
        commands: ["false"],
      },
    ])
  })

  it("should record the values a string check compared", async () => {
    const hostSession = createSession("plan")
    await ensureOrMessage(hostSession.host, { check: "echo old", want: "new", fix: "true" })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        kind: "ensure",
        name: "Make marker",
        details: { status: "changed", changed: true, comparison: { kind: "string", got: "old", want: "new" } },
        commands: ["echo old"],
      },
    ])
  })

  it("should record a read with its command's raw output", async () => {
    const cmd = "echo out; echo err >&2"
    const hostSession = createSession()
    await readOrMessage(hostSession.host, cmd)

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      { kind: "read", name: cmd, details: { status: "unchanged", changed: false }, commands: [cmd] },
    ])
    expect(toPlainResult(hostSession.stepRecords[0]?.commands[0]?.output)).toStrictEqual({
      stdout: "out\n",
      stderr: "err\n",
      exitCode: 0,
    })
  })

  it("should record a run with `when: false` as unchanged, with no commands", async () => {
    const hostSession = createSession()
    await runOrMessage(hostSession.host, "true", { when: false })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      { kind: "run", name: "Make marker", details: { status: "unchanged", changed: false }, commands: [] },
    ])
  })

  it("should record a run with `when: true` as ran, without running it in plan", async () => {
    const hostSession = createSession("plan")
    await runOrMessage(hostSession.host, "true", { when: true })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      { kind: "run", name: "Make marker", details: { status: "ran", changed: true }, commands: [] },
    ])
  })

  it("should record a failed step's error and its failing command's output", async () => {
    const hostSession = createSession()
    await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "echo nope >&2; exit 2" })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        kind: "ensure",
        name: "Make marker",
        details: "failed to run the fix for step 'Make marker' -> exited with code 2: nope",
        commands: ["false", "echo nope >&2; exit 2"],
      },
    ])
    expect(toPlainResult(hostSession.stepRecords[0]?.commands[1]?.output)).toStrictEqual({
      stdout: "",
      stderr: "nope\n",
      exitCode: 2,
    })
  })

  it("should record a failure the script caught as the step's error", async () => {
    const hostSession = createSession()
    await ensureOrMessage(hostSession.host, {
      check: "false",
      want: true,
      fix: async ({ exec }) => {
        await attempt(async () => exec("exit 1"))
      },
    })

    expect(toPlainRecords(hostSession.stepRecords)[0]?.details).toBe("failed to run 'exit 1' -> exited with code 1")
  })

  it("should record commands from the given read and exec under their step", async () => {
    const file = path.join(await makeTempDir("record-"), "file")
    const hostSession = createSession()
    await ensureOrMessage(hostSession.host, {
      check: async ({ read }) => (await read(`cat '${file}' 2>/dev/null || true`)) === "done",
      want: true,
      fix: async ({ exec }) => {
        await exec(`echo done > '${file}'`)
      },
    })

    expect(toPlainRecords(hostSession.stepRecords)[0]?.commands).toStrictEqual([
      `cat '${file}' 2>/dev/null || true`,
      `echo done > '${file}'`,
      `cat '${file}' 2>/dev/null || true`,
    ])
  })

  it("should keep commands in call order when they run at once", async () => {
    const hostSession = createSession()
    await runOrMessage(
      hostSession.host,
      async ({ exec }) => {
        await Promise.all([exec("sleep 0.1; echo a"), exec("echo b")])
      },
      { when: true },
    )

    expect(toPlainRecords(hostSession.stepRecords)[0]?.commands).toStrictEqual(["sleep 0.1; echo a", "echo b"])
  })

  it("should record steps in the order the script calls them", async () => {
    const hostSession = createSession()
    await readOrMessage(hostSession.host, "echo hi")
    await ensureOrMessage(hostSession.host, { check: "true", want: true, fix: "true" })

    expect(toPlainRecords(hostSession.stepRecords).map(({ kind }) => kind)).toStrictEqual(["read", "ensure"])
  })

  it("should not record a nested step, or a step after the host failed", async () => {
    const hostSession = createSession()
    const { host: h } = hostSession
    await ensureOrMessage(h, {
      check: "false",
      want: true,
      fix: async () => {
        await h.ensure("Inner", { check: "true", want: true, fix: "true" })
      },
    })
    await attempt(async () => h.read("echo after"))

    expect(toPlainRecords(hostSession.stepRecords).map(({ name }) => name)).toStrictEqual(["Make marker"])
  })

  it("should record a command that can't run", async () => {
    const hostSession = createSession("apply", "a.lan")
    await readOrMessage(hostSession.host, "echo hi")

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        kind: "read",
        name: "echo hi",
        details: "failed to read 'echo hi' -> target 'a.lan' isn't supported yet (only '@local')",
        commands: ["echo hi"],
      },
    ])
    expect(toPlainResult(hostSession.stepRecords[0]?.commands[0]?.output)).toBe(
      "target 'a.lan' isn't supported yet (only '@local')",
    )
  })
})
