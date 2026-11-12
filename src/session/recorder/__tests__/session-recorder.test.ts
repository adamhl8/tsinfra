import { describe, expect, it } from "bun:test"

import type { SessionRecorder, StepRecord } from "#session/recorder/recorder.ts"
import { createHostRecord, createSessionRecorder } from "#session/recorder/recorder.ts"
import { runLocal } from "#transport/local.ts"
import type { Shell, Transport } from "#transport/transport.ts"

// Stand in for `sudo` with a function that prints the command it's given, then runs it.
const transport: Transport = async (cmd) => runLocal(`sudo() { echo "sudo $*"; "$@"; }\n${cmd}`)

/**
 * Runs `echo hi` in a step, on the shell `getShell` gives, and returns its stdout, the commands the step recorded, and
 * the step's `sudo`.
 */
const runInStep = async (getShell: (sessionRecorder: SessionRecorder) => Shell) => {
  const hostRecord = createHostRecord("a", "@local")
  const sessionRecorder = createSessionRecorder(hostRecord, { sudo: false }, transport)
  sessionRecorder.startStep("a", "file")
  const stdout = await getShell(sessionRecorder).exec("echo hi")
  const { runningStep } = hostRecord
  return { stdout, recordedCmds: runningStep?.commands.map(({ cmd }) => cmd), sudo: runningStep?.sudo }
}

describe("SessionRecorder.getStepShell", () => {
  it("should run a sudo: true step's script in sudo sh -s, record the script without it, and record sudo", async () => {
    expect(await runInStep((sessionRecorder) => sessionRecorder.getStepShell({ sudo: true }))).toStrictEqual({
      stdout: "sudo sh -s\nhi\n",
      recordedCmds: ["echo hi"],
      sudo: true,
    })
  })

  it("should run a step without sudo as it is", async () => {
    expect(await runInStep((sessionRecorder) => sessionRecorder.getStepShell({ sudo: false }))).toStrictEqual({
      stdout: "hi\n",
      recordedCmds: ["echo hi"],
      sudo: false,
    })
  })
})

/** Gives the tools' shell inside a step that chose `sudo: true`. */
const getToolShellInSudoStep = (sessionRecorder: SessionRecorder) => {
  sessionRecorder.getStepShell({ sudo: true })
  return sessionRecorder.getToolShell()
}

describe("SessionRecorder.getToolShell", () => {
  it("should record a tool's command under a sudo: true step, without running it as root", async () => {
    expect(await runInStep(getToolShellInSudoStep)).toStrictEqual({
      stdout: "hi\n",
      recordedCmds: ["echo hi"],
      sudo: true,
    })
  })
})

describe("SessionRecorder steps", () => {
  it("should keep a step as the running step until it finishes, then add it to the step records", async () => {
    const hostRecord = createHostRecord("a", "@local")
    const sessionRecorder = createSessionRecorder(hostRecord, { sudo: false }, transport)
    sessionRecorder.startStep("a", "file")
    await sessionRecorder.getStepShell({ sudo: false }).exec("echo hi")
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
      sudo: false,
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
