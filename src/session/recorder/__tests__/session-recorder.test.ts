import { describe, expect, it } from "bun:test"

import type { HostRecord, StepRecord } from "#session/recorder/recorder.ts"
import { createHostRecord, createSessionRecorder } from "#session/recorder/recorder.ts"
import { runLocal } from "#transport/local.ts"
import type { StepShellOptions, Transport } from "#transport/transport.ts"

// Stand in for `sudo` with a function that prints the command it's given, then runs it.
const transport: Transport = async (cmd) => runLocal(`sudo() { echo "sudo $*"; "$@"; }\n${cmd}`)

const NO_OPTIONS: StepShellOptions = { sudo: false, env: {}, secretEnv: {} }

/** Starts a step on a new recorder, and returns the host record and the step's shells, built from `options`. */
const startStepWithShells = (options: StepShellOptions) => {
  const hostRecord = createHostRecord("a", "@local")
  const sessionRecorder = createSessionRecorder(hostRecord, { sudo: false }, transport)
  sessionRecorder.startStep("a", "file")
  return { hostRecord, ...sessionRecorder.getStepShells(options) }
}

/** Returns the running step's options and the commands it recorded. */
const getRunningStep = (hostRecord: HostRecord) => ({
  options: hostRecord.runningStep?.options,
  recordedCmds: hostRecord.runningStep?.commands.map(({ cmd }) => cmd),
})

describe("SessionRecorder.getStepShells", () => {
  it("should run a sudo: true step's script in sudo sh -s, record the script without it, and record sudo", async () => {
    const { hostRecord, stepShell } = startStepWithShells({ ...NO_OPTIONS, sudo: true })
    const stdout = await stepShell.exec("echo hi")

    expect({ stdout, ...getRunningStep(hostRecord) }).toStrictEqual({
      stdout: "sudo sh -s\nhi\n",
      options: { ...NO_OPTIONS, sudo: true },
      recordedCmds: ["echo hi"],
    })
  })

  it("should run a step without sudo as it is", async () => {
    const { hostRecord, stepShell } = startStepWithShells(NO_OPTIONS)
    const stdout = await stepShell.exec("echo hi")

    expect({ stdout, ...getRunningStep(hostRecord) }).toStrictEqual({
      stdout: "hi\n",
      options: NO_OPTIONS,
      recordedCmds: ["echo hi"],
    })
  })

  it("should record the step's options with each secret masked, and its commands as written", async () => {
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
      options: { sudo: false, env, secretEnv: { TOKEN: "[MASKED]" } },
      recordedCmds: [cmd],
      hasSecret: false,
    })
  })

  it("should give the tools' shell the step's variables, without running it as root", async () => {
    const { hostRecord, toolShell } = startStepWithShells({ ...NO_OPTIONS, sudo: true, env: { V: "v" } })
    const stdout = await toolShell.exec('printf %s "$V"')

    expect({ stdout, ...getRunningStep(hostRecord) }).toStrictEqual({
      stdout: "v",
      options: { ...NO_OPTIONS, sudo: true, env: { V: "v" } },
      recordedCmds: ['printf %s "$V"'],
    })
  })
})

describe("SessionRecorder steps", () => {
  it("should keep a step as the running step until it finishes, then add it to the step records", async () => {
    const hostRecord = createHostRecord("a", "@local")
    const sessionRecorder = createSessionRecorder(hostRecord, { sudo: false }, transport)
    sessionRecorder.startStep("a", "file")
    await sessionRecorder.getStepShells(NO_OPTIONS).stepShell.exec("echo hi")
    const whileRunning = [hostRecord.runningStep?.name, hostRecord.stepRecords.length]

    sessionRecorder.finishStep("changed")

    const [stepRecord] = hostRecord.stepRecords
    expect([
      whileRunning,
      hostRecord.runningStep,
      stepRecord?.status,
      stepRecord?.commands.map(({ cmd }) => cmd),
    ]).toStrictEqual([["a", 0], undefined, "changed", ["echo hi"]])
  })

  it("should give a failed step to the host's failure, not to the step records", () => {
    const hostRecord = createHostRecord("a", "@local")
    const sessionRecorder = createSessionRecorder(hostRecord, { sudo: false }, transport)
    const error = new Error("boom")
    sessionRecorder.startStep("a", "file")

    sessionRecorder.failStep(error)

    const stepRecord: StepRecord = {
      name: "a",
      kind: "file",
      options: NO_OPTIONS,
      commands: [],
      comparisons: {},
      waitingOn: [],
    }
    expect([hostRecord.runningStep, hostRecord.stepRecords, hostRecord.failure]).toStrictEqual([
      undefined,
      [],
      { kind: "step", stepRecord, error, hints: [] },
    ])
  })
})
