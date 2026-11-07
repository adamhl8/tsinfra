import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import type { Result } from "ts-explicit-errors"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { createSession, ensureOrMessage, getFailureMessage, readOrMessage, runOrMessage } from "#__tests__/session.ts"
import type { Host } from "#session/session.ts"
import type { StepRecord } from "#session/step-recorder.ts"

const toPlainResult = <T>(result: Result<T> | undefined) => (isErr(result) ? messageChain(result) : result)

/** Turns records into plain values to compare, with each error as its message chain and each command as its text. */
const toPlainRecords = (stepRecords: StepRecord[]) =>
  stepRecords.map(({ name, kind, status, commands }) => ({
    name,
    kind,
    status: toPlainResult(status),
    commands: commands.map(({ cmd }) => cmd),
  }))

describe("createHostSession", () => {
  it("should throw the first failure again without running anything once the host has failed", async () => {
    const file = path.join(await makeTempDir(), "ran")
    const hostSession = await createSession()
    await readOrMessage(hostSession.host, "exit 1")

    expect(await readOrMessage(hostSession.host, `touch '${file}'`)).toBe(
      "failed to read 'exit 1' -> exited with code 1",
    )
    expect(await bun.file(file).exists()).toBe(false)
  })

  it("should keep the first failure when a later one doesn't wrap it", async () => {
    const hostSession = await createSession()
    const { host: h } = hostSession

    await Promise.allSettled([
      h.ensure("First", { check: "sleep 0.1; false", want: true, fix: "exit 1" }),
      h.ensure("Second", { check: "true", want: true, fix: "true" }),
    ])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while ensure step 'First' is running")
  })
})

describe("step results", () => {
  it("should give the script only what ChangeStepResult declares", async () => {
    const hostSession = await createSession("plan")
    const ensureResult = await hostSession.host.ensure("Change", { check: "false", want: true, fix: "true" })
    const runResult = await hostSession.host.run("Follow up", "true", { after: [ensureResult] })

    expect([ensureResult, runResult]).toStrictEqual([
      { name: "Change", kind: "ensure", changed: true },
      { name: "Follow up", kind: "run", changed: true },
    ])
    expect(hostSession.stepRecords[0]?.status).toBe("changed")
  })
})

describe("h inside a step", () => {
  it("should fail the host when a check function calls h.inspect", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      check: async () => (await h.inspect("true")).exitCode === 0,
      want: true,
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> 'inspect' can't run while ensure step 'Make marker' is running",
    )
  })

  it("should fail the host when a check function calls h.read", async () => {
    const hostSession = await createSession()
    const { host: h } = hostSession
    const message =
      "failed to compare the host with what the step wants -> 'read' can't run while ensure step 'Make marker' is running"
    const result = await ensureOrMessage(h, {
      check: async () => (await h.read("true")) === "",
      want: true,
      fix: "true",
    })

    expect(result).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when a check function calls h.ensure", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      check: async () => {
        await h.ensure("Inner", { check: "echo v", want: "v", fix: "true" })
        return "v"
      },
      want: "v",
      fix: "true",
    })

    expect(result).toBe(
      "failed to compare the host with what the step wants -> 'ensure' can't run while ensure step 'Make marker' is running",
    )
  })

  it("should fail the host when a fix function calls h.ensure", async () => {
    const { host: h } = await createSession()
    const result = await ensureOrMessage(h, {
      check: "false",
      want: true,
      fix: async () => {
        await h.ensure("Inner", { check: "true", want: true, fix: "true" })
      },
    })

    expect(result).toBe("failed to run the fix -> 'ensure' can't run while ensure step 'Make marker' is running")
  })

  it("should fail the host when a run function calls h.run", async () => {
    const { host: h } = await createSession()
    const result = await runOrMessage(
      h,
      async () => {
        await h.run("Inner", "true", { after: "always" })
      },
      { after: "always" },
    )

    expect(result).toBe("failed to run the step -> 'run' can't run while run step 'Make marker' is running")
  })

  it("should fail the host when steps run at once with Promise.all", async () => {
    const hostSession = await createSession()
    const { host: h } = hostSession

    await Promise.allSettled([
      h.ensure("First", { check: "sleep 0.1", want: true, fix: "true" }),
      h.ensure("Second", { check: "true", want: true, fix: "true" }),
    ])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while ensure step 'First' is running")
  })

  it("should name a running read by its command", async () => {
    const hostSession = await createSession()
    const { host: h } = hostSession

    await Promise.allSettled([h.read("sleep 0.1"), h.ensure("Second", { check: "true", want: true, fix: "true" })])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while read step 'sleep 0.1' is running")
  })

  it("should name a running inspect by its command", async () => {
    const hostSession = await createSession()
    const { host: h } = hostSession

    await Promise.allSettled([h.inspect("sleep 0.1"), h.ensure("Second", { check: "true", want: true, fix: "true" })])

    expect(getFailureMessage(hostSession)).toBe("'ensure' can't run while inspect step 'sleep 0.1' is running")
  })

  it("should fail the host when h.read runs alongside a step", async () => {
    const hostSession = await createSession()
    const { host: h } = hostSession

    await Promise.allSettled([h.ensure("First", { check: "sleep 0.1", want: true, fix: "true" }), h.read("true")])

    expect(getFailureMessage(hostSession)).toBe("'read' can't run while ensure step 'First' is running")
  })

  it("should allow calls on h again once a step finishes", async () => {
    const { host: h } = await createSession()

    expect(await ensureOrMessage(h, { check: "true", want: true, fix: "true" })).toMatchObject({ changed: false })
    expect(await ensureOrMessage(h, { check: "true", want: true, fix: "true" })).toMatchObject({ changed: false })
    expect(await readOrMessage(h, "echo hi")).toBe("hi")
  })
})

describe("step records", () => {
  it("should record an ensure's check, fix, and second check in apply", async () => {
    const marker = path.join(await makeTempDir(), "marker")
    const hostSession = await createSession("apply")
    await ensureOrMessage(hostSession.host, { check: `test -f '${marker}'`, want: true, fix: `touch '${marker}'` })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        name: "Make marker",
        kind: "ensure",
        status: "changed",
        commands: [`test -f '${marker}'`, `touch '${marker}'`, `test -f '${marker}'`],
      },
    ])
    expect(hostSession.stepRecords[0]?.comparisons.before?.values).toStrictEqual({ kind: "exit", got: 1, want: true })
  })

  it("should record only the check in plan", async () => {
    const hostSession = await createSession("plan")
    await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "true" })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        name: "Make marker",
        kind: "ensure",
        status: "changed",
        commands: ["false"],
      },
    ])
    expect(hostSession.stepRecords[0]?.comparisons.before?.values).toStrictEqual({ kind: "exit", got: 1, want: true })
  })

  it("should record the values a string check compared", async () => {
    const hostSession = await createSession("plan")
    await ensureOrMessage(hostSession.host, { check: "echo old", want: "new", fix: "true" })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        name: "Make marker",
        kind: "ensure",
        status: "changed",
        commands: ["echo old"],
      },
    ])
    expect(hostSession.stepRecords[0]?.comparisons.before?.values).toStrictEqual({
      kind: "string",
      got: "old",
      want: "new",
    })
  })

  it("should record an inspect as observed, even when its command exits non-zero", async () => {
    const cmd = "exit 3"
    const hostSession = await createSession()
    await hostSession.host.inspect(cmd)

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      { name: cmd, kind: "inspect", status: "observed", commands: [cmd] },
    ])
  })

  it("should record a read with its command's raw output", async () => {
    const cmd = "echo out; echo err >&2"
    const hostSession = await createSession()
    await readOrMessage(hostSession.host, cmd)

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      { name: cmd, kind: "read", status: "observed", commands: [cmd] },
    ])
    expect(toPlainResult(hostSession.stepRecords[0]?.commands[0]?.output)).toStrictEqual({
      stdout: "out\n",
      stderr: "err\n",
      exitCode: 0,
    })
  })

  it("should record a run that wasn't triggered as unchanged, with no commands", async () => {
    const hostSession = await createSession()
    await runOrMessage(hostSession.host, "true", { after: [{ name: "Stay right", kind: "ensure", changed: false }] })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      { name: "Make marker", kind: "run", status: "unchanged", commands: [] },
    ])
  })

  it("should record a triggered run as ran, without running it in plan", async () => {
    const hostSession = await createSession("plan")
    await runOrMessage(hostSession.host, "true", { after: "always" })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      { name: "Make marker", kind: "run", status: "ran", commands: [] },
    ])
  })

  it("should record a failed step's error and its failing command's output", async () => {
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "echo nope >&2; exit 2" })

    expect(toPlainRecords(hostSession.stepRecords)).toStrictEqual([
      {
        name: "Make marker",
        kind: "ensure",
        status: "failed to run the fix -> exited with code 2: nope",
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
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, {
      check: "false",
      want: true,
      fix: async ({ exec }) => {
        await attempt(async () => exec("exit 1"))
      },
    })

    expect(toPlainRecords(hostSession.stepRecords)[0]?.status).toBe("failed to run 'exit 1' -> exited with code 1")
  })

  it("should record commands from the given read and exec under their step", async () => {
    const file = path.join(await makeTempDir(), "file")
    const hostSession = await createSession()
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
    const hostSession = await createSession()
    await runOrMessage(
      hostSession.host,
      async ({ exec }) => {
        await Promise.all([exec("sleep 0.1; echo a"), exec("echo b")])
      },
      { after: "always" },
    )

    expect(toPlainRecords(hostSession.stepRecords)[0]?.commands).toStrictEqual(["sleep 0.1; echo a", "echo b"])
  })

  it("should stamp a command with the phase running when it was called, not when it finished", async () => {
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, {
      check: async ({ read }) => {
        // Leave this running on purpose, so it finishes during the fix.
        void read("sleep 0.1")
        return (await read("echo old")) === "new"
      },
      want: true,
      fix: "true",
      verify: false,
    })

    expect(hostSession.stepRecords[0]?.commands).toMatchObject([
      { cmd: "sleep 0.1", phase: "before" },
      { cmd: "echo old", phase: "before" },
      { cmd: "true", phase: "fix" },
    ])
  })

  it("should record steps in the order the script calls them", async () => {
    const hostSession = await createSession()
    await readOrMessage(hostSession.host, "echo hi")
    await ensureOrMessage(hostSession.host, { check: "true", want: true, fix: "true" })

    expect(toPlainRecords(hostSession.stepRecords).map(({ kind }) => kind)).toStrictEqual(["read", "ensure"])
  })

  it("should not record a nested step, or a step after the host failed", async () => {
    const hostSession = await createSession()
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
})

/** Returns what a step recorded, with each comparison as whether it was in sync, and each command as its phase. */
const toConvergeRecord = (hostSession: Awaited<ReturnType<typeof createSession>>) => {
  const { status, commands, comparisons } = hostSession.stepRecords[0] ?? {}
  return {
    status: toPlainResult(status),
    before: comparisons?.before?.inSync,
    after: comparisons?.after?.inSync,
    phases: commands?.map(({ phase }) => phase),
  }
}

describe("what a converging step records", () => {
  it("should record a compare and no fix when already in sync", async () => {
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, { check: "true", want: true, fix: "exit 1" })

    expect(toConvergeRecord(hostSession)).toStrictEqual({
      status: "unchanged",
      before: true,
      after: undefined,
      phases: ["before"],
    })
  })

  it("should record one compare in plan", async () => {
    const hostSession = await createSession("plan")
    await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "exit 1" })

    expect(toConvergeRecord(hostSession)).toStrictEqual({
      status: "changed",
      before: false,
      after: undefined,
      phases: ["before"],
    })
  })

  it("should record both compares and every phase when the fix works", async () => {
    const marker = path.join(await makeTempDir(), "marker")
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, { check: `test -f '${marker}'`, want: true, fix: `touch '${marker}'` })

    expect(toConvergeRecord(hostSession)).toStrictEqual({
      status: "changed",
      before: false,
      after: true,
      phases: ["before", "fix", "after"],
    })
  })

  it("should skip the after phase with verify off", async () => {
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "true", verify: false })

    expect(toConvergeRecord(hostSession)).toStrictEqual({
      status: "changed",
      before: false,
      after: undefined,
      phases: ["before", "fix"],
    })
  })

  it("should record both compares when the host still differs after the fix", async () => {
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "true" })

    expect(toConvergeRecord(hostSession)).toStrictEqual({
      status: "the host's state still differs after the fix",
      before: false,
      after: false,
      phases: ["before", "fix", "after"],
    })
  })

  it("should keep the first compare when the fix fails", async () => {
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, { check: "false", want: true, fix: "exit 1" })

    expect(toConvergeRecord(hostSession)).toStrictEqual({
      status: "failed to run the fix -> exited with code 1",
      before: false,
      after: undefined,
      phases: ["before", "fix"],
    })
  })

  it("should keep the first compare when the compare after the fix fails", async () => {
    const marker = path.join(await makeTempDir(), "marker")
    const cmd = `test ! -f '${marker}'`
    const hostSession = await createSession()
    await ensureOrMessage(hostSession.host, {
      check: async ({ read }) => {
        await read(cmd)
        return false
      },
      want: true,
      fix: `touch '${marker}'`,
    })

    expect(toConvergeRecord(hostSession)).toStrictEqual({
      status: `failed to compare the host with what the step wants -> failed to read '${cmd}' -> exited with code 1`,
      before: false,
      after: undefined,
      phases: ["before", "fix", "after"],
    })
  })

  it("should record what a waiting step waited on, and run nothing", async () => {
    const hostSession = await createSession("plan")
    const { host: h } = hostSession
    const brew = await h.ensure("Install brew packages", { check: "false", want: true, fix: "true" })
    await h.ensure("Install fish plugins", { needs: [brew], check: "true", want: true, fix: "true" })

    expect(hostSession.stepRecords[1]).toMatchObject({
      status: "waiting",
      waitingOn: ["Install brew packages"],
      comparisons: {},
      commands: [],
    })
  })

  it.each([
    ["a read", async (h: Host) => h.read("true")],
    ["an inspect", async (h: Host) => h.inspect("true")],
    ["a run", async (h: Host) => h.run("Run", "true", { after: "always" })],
  ])("should record no comparison or phase for %s", async (_, callStep) => {
    const hostSession = await createSession()
    await callStep(hostSession.host)

    expect(hostSession.stepRecords[0]?.comparisons).toStrictEqual({})
    expect(hostSession.stepRecords[0]?.commands[0]).not.toHaveProperty("phase")
  })
})
