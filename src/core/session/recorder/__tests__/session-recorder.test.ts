import { describe, expect, it } from "bun:test"

import { err, messageChain } from "ts-explicit-errors"

import type { ValidStepShellOptions } from "#core/session/handlers/options/step.ts"
import type { Comparison } from "#core/session/handlers/shared/converge.ts"
import type { ValidToolOptions } from "#core/session/handlers/tools.ts"
import { createHostMeta } from "#core/session/host-meta.ts"
import type { HostRecord, StepRecord } from "#core/session/recorder/records.ts"
import { createHostRecord, getFinishedStepRecords } from "#core/session/recorder/records.ts"
import { createSessionRecorder } from "#core/session/recorder/session-recorder.ts"
import type { Transport } from "#core/transport.ts"
import { runLocal } from "#core/transport/local.ts"

// Stand in for `sudo` with a function that prints the command it's given, then runs it.
const transport: Transport = async (cmd) => runLocal(`sudo() { echo "sudo $*"; "$@"; }\n${cmd}`)

const NO_SHELL_OPTIONS: ValidStepShellOptions = { sudo: false, env: {}, secretEnv: {} }
const NO_TOOL_OPTIONS: ValidToolOptions = { env: {}, secretEnv: {}, input: undefined, maskOutput: false }

/** Starts a step on a new recorder, and returns the host record and the step's shells, built from `shellOptions`. */
const startStepWithShells = (shellOptions: ValidStepShellOptions) => {
  const hostRecord = createHostRecord("a", "@local")
  const sessionRecorder = createSessionRecorder(hostRecord, { sudo: false }, transport, createHostMeta("a", undefined))
  sessionRecorder.startStep("a", "file")
  return { hostRecord, sessionRecorder, ...sessionRecorder.getStepShells(shellOptions) }
}

/** Returns the running step's options and the commands it recorded. */
const getRunningStep = (hostRecord: HostRecord) => ({
  options: hostRecord.runningStep?.options,
  recordedCmds: hostRecord.runningStep?.commands.map(({ cmd }) => cmd),
})

describe("SessionRecorder.getStepShells", () => {
  it("should run a sudo: true step's script in sudo sh -s, record the script without it, and record sudo", async () => {
    const { hostRecord, stepShell } = startStepWithShells({ ...NO_SHELL_OPTIONS, sudo: true })
    const stdout = await stepShell.exec("echo hi")

    expect({ stdout, ...getRunningStep(hostRecord) }).toStrictEqual({
      stdout: "sudo sh -s\nhi\n",
      options: { sudo: true },
      recordedCmds: ["echo hi"],
    })
  })

  it("should run a step without sudo as it is", async () => {
    const { hostRecord, stepShell } = startStepWithShells(NO_SHELL_OPTIONS)
    const stdout = await stepShell.exec("echo hi")

    expect({ stdout, ...getRunningStep(hostRecord) }).toStrictEqual({
      stdout: "hi\n",
      options: {},
      recordedCmds: ["echo hi"],
    })
  })

  it("should record the options the step set with each secret masked, and its commands as written", async () => {
    const secret = "s3cret-value"
    const env = { URL: "https://example.com" }
    const { hostRecord, stepShell } = startStepWithShells({ sudo: false, env, secretEnv: { TOKEN: secret } })
    // Check the secret's length, so the command can see it got the secret without holding or printing it.
    const cmd = `test "\${#TOKEN}" = ${secret.length}`
    const stdout = await stepShell.exec(cmd)

    expect({
      stdout,
      ...getRunningStep(hostRecord),
      hasSecret: JSON.stringify(hostRecord).includes(secret),
    }).toStrictEqual({
      stdout: "",
      options: { env, secretEnv: { TOKEN: "[MASKED]" } },
      recordedCmds: [cmd],
      hasSecret: false,
    })
  })

  it("should give a tool call's shell the step's variables, without running it as root", async () => {
    const { hostRecord, getToolShell } = startStepWithShells({ ...NO_SHELL_OPTIONS, sudo: true, env: { V: "v" } })
    const stdout = await getToolShell("read", NO_TOOL_OPTIONS).exec('printf %s "$V"')

    expect({ stdout, ...getRunningStep(hostRecord) }).toStrictEqual({
      stdout: "v",
      options: { sudo: true, env: { V: "v" } },
      recordedCmds: ['printf %s "$V"'],
    })
  })
  it("should record a tool call on its command, and no tool call on a step's own command", async () => {
    const { hostRecord, stepShell, getToolShell } = startStepWithShells(NO_SHELL_OPTIONS)
    await getToolShell("exec", { ...NO_TOOL_OPTIONS, input: "x", maskOutput: true }).exec("true")
    await stepShell.exec("true")

    expect(hostRecord.runningStep?.commands.map(({ toolCall }) => toolCall)).toStrictEqual([
      { toolName: "exec", options: { input: "<content>", maskOutput: true } },
      undefined,
    ])
  })
})

describe("SessionRecorder steps", () => {
  it("should keep a step as the running step until it finishes, then add it to the step records", async () => {
    const hostRecord = createHostRecord("a", "@local")
    const sessionRecorder = createSessionRecorder(
      hostRecord,
      { sudo: false },
      transport,
      createHostMeta("a", undefined),
    )
    sessionRecorder.startStep("a", "file")
    await sessionRecorder.getStepShells(NO_SHELL_OPTIONS).stepShell.exec("echo hi")
    const whileRunning = [hostRecord.runningStep?.name, getFinishedStepRecords(hostRecord).length]

    sessionRecorder.finishStep("changed")

    const [stepRecord] = getFinishedStepRecords(hostRecord)
    expect([
      whileRunning,
      hostRecord.runningStep,
      stepRecord?.status,
      stepRecord?.commands.map(({ cmd }) => cmd),
    ]).toStrictEqual([["a", 0], undefined, "changed", ["echo hi"]])
  })

  it("should give a failed step to the host's failure, not to the host's entries", () => {
    const hostRecord = createHostRecord("a", "@local")
    const sessionRecorder = createSessionRecorder(
      hostRecord,
      { sudo: false },
      transport,
      createHostMeta("a", undefined),
    )
    const error = new Error("boom")
    sessionRecorder.startStep("a", "file")

    sessionRecorder.failStep(error)

    const stepRecord: StepRecord = {
      name: "a",
      kind: "file",
      options: {},
      commands: [],
      comparisons: {},
      waitingOn: [],
      messages: [],
    }
    expect([hostRecord.runningStep, hostRecord.entries, hostRecord.failure]).toStrictEqual([
      undefined,
      [],
      { kind: "step", stepRecord, error, hints: [] },
    ])
  })
})

const SECRET = "s3cret-value"

/** Returns each finished step's name, and each of its commands with its output. */
const getStepCommands = (hostRecord: HostRecord) =>
  getFinishedStepRecords(hostRecord).map(({ name, commands }) => ({
    name,
    commands: commands.map(({ cmd, output }) => ({ cmd, output })),
  }))

/** Returns each command of the running step with its output. */
const getRunningCommands = (hostRecord: HostRecord) =>
  hostRecord.runningStep?.commands.map(({ cmd, output }) => ({ cmd, output }))

/** Returns `stdout` as a command's output, with no stderr and exit code 0. */
const toOutput = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 })

describe("SessionRecorder masking", () => {
  it("should mask a secretEnv value from its step on, and still return it to the script", async () => {
    const { hostRecord, sessionRecorder, stepShell } = startStepWithShells({
      ...NO_SHELL_OPTIONS,
      secretEnv: { TOKEN: SECRET },
    })
    const stdout = await stepShell.exec('printf %s "$TOKEN"')
    sessionRecorder.finishStep("ran")
    sessionRecorder.startStep(`echo ${SECRET}`, "read")
    await sessionRecorder.getStepShells(NO_SHELL_OPTIONS).stepShell.exec(`echo ${SECRET}`)
    sessionRecorder.finishStep("observed")

    expect({ stdout, steps: getStepCommands(hostRecord) }).toStrictEqual({
      stdout: SECRET,
      steps: [
        { name: "a", commands: [{ cmd: 'printf %s "$TOKEN"', output: toOutput("[MASKED]") }] },
        { name: "echo [MASKED]", commands: [{ cmd: "echo [MASKED]", output: toOutput("[MASKED]\n") }] },
      ],
    })
  })

  it("should mask a maskOutput command's own output, and the value in later commands", async () => {
    const { hostRecord, stepShell } = startStepWithShells(NO_SHELL_OPTIONS)
    // Build the secret from two parts, so the command's own text doesn't hold it.
    const stdout = await stepShell.exec(String.raw`printf '%s-%s\n' s3cret value`, { maskOutput: true })
    await stepShell.exec(`test ${SECRET} = ${SECRET}`)

    expect({ stdout, commands: getRunningCommands(hostRecord) }).toStrictEqual({
      stdout: `${SECRET}\n`,
      commands: [
        { cmd: String.raw`printf '%s-%s\n' s3cret value`, output: toOutput("[MASKED]\n") },
        { cmd: "test [MASKED] = [MASKED]", output: toOutput("") },
      ],
    })
  })

  it("should mask one line of a multi-line secret on its own", async () => {
    const { hostRecord, stepShell } = startStepWithShells({
      ...NO_SHELL_OPTIONS,
      secretEnv: { KEY: "first-line\nsecond-line" },
    })
    await stepShell.exec(String.raw`printf "%s\n" "$KEY" | tail -n 1`)

    expect(getRunningCommands(hostRecord)).toStrictEqual([
      { cmd: String.raw`printf "%s\n" "$KEY" | tail -n 1`, output: toOutput("[MASKED]\n") },
    ])
  })

  it("should mask a secret through the failure's error chain, and leave it the same when recorded again", () => {
    const { hostRecord, sessionRecorder } = startStepWithShells({ ...NO_SHELL_OPTIONS, secretEnv: { TOKEN: SECRET } })
    const commandError = err(`exited with code 1: ${SECRET}`, undefined)
    sessionRecorder.failStep(err("failed to run the step", commandError))
    const hostError = sessionRecorder.recordFailure(err("failed to run the host", hostRecord.failure?.error), "host fn")

    expect({
      chain: messageChain(hostError),
      hasSecretInStack: commandError.stack?.includes(SECRET),
    }).toStrictEqual({
      chain: "failed to run the host -> failed to run the step -> exited with code 1: [MASKED]",
      hasSecretInStack: false,
    })
  })

  it("should mask a secret in a recorded comparison, and leave the comparison converge holds as it is", () => {
    const { hostRecord, sessionRecorder } = startStepWithShells({ ...NO_SHELL_OPTIONS, secretEnv: { TOKEN: SECRET } })
    const comparison: Comparison = { inSync: false, values: { kind: "string", got: "old", want: SECRET } }
    sessionRecorder.convergeRecorder.recordComparison("before", comparison)

    expect([hostRecord.runningStep?.comparisons.before, comparison.values]).toStrictEqual([
      { inSync: false, values: { kind: "string", got: "old", want: "[MASKED]" } },
      { kind: "string", got: "old", want: SECRET },
    ])
  })

  it("should mask a step's own options, and record them after its shell options", () => {
    const { hostRecord, sessionRecorder } = startStepWithShells({ ...NO_SHELL_OPTIONS, secretEnv: { TOKEN: SECRET } })
    sessionRecorder.recordOptions({ validate: `check ${SECRET}` })

    // Compare the JSON, because it keeps the order the options were recorded in.
    expect(JSON.stringify(hostRecord.runningStep?.options)).toBe(
      JSON.stringify({ secretEnv: { TOKEN: "[MASKED]" }, validate: "check [MASKED]" }),
    )
  })

  it("should mask in one pass, so a secret inside [MASKED] doesn't match, and mask nothing for an empty value", async () => {
    const secretEnv = { TOKEN: SECRET, SHORT: "MASK", EMPTY: "" }
    const { hostRecord, stepShell } = startStepWithShells({ ...NO_SHELL_OPTIONS, secretEnv })
    await stepShell.exec('printf "%s %s|" "$TOKEN" "$SHORT"')

    expect({ ...getRunningStep(hostRecord), commands: getRunningCommands(hostRecord) }).toStrictEqual({
      options: { secretEnv: { TOKEN: "[MASKED]", SHORT: "[MASKED]", EMPTY: "" } },
      recordedCmds: ['printf "%s %s|" "$TOKEN" "$SHORT"'],
      commands: [{ cmd: 'printf "%s %s|" "$TOKEN" "$SHORT"', output: toOutput("[MASKED] [MASKED]|") }],
    })
  })
})
