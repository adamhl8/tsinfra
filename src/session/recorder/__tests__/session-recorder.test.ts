import { describe, expect, it } from "bun:test"

import type { StepRecord } from "#session/recorder/recorder.ts"
import { createHostRecord, createSessionRecorder } from "#session/recorder/recorder.ts"
import { runLocal } from "#transport/local.ts"
import type { Transport } from "#transport/transport.ts"

// Stand in for `sudo` with a function that prints the command it's given, then runs it.
const transport: Transport = async (cmd) => runLocal(`sudo() { echo "sudo $*"; "$@"; }\n${cmd}`)

/** Runs `echo hi` in a step on the shell for `sudo`, and returns its stdout and the commands the step recorded. */
const runInStep = async (sudo: boolean) => {
  const hostRecord = createHostRecord("a", "@local")
  const sessionRecorder = createSessionRecorder(hostRecord, { sudo: false }, transport)
  sessionRecorder.startStep("a", "file")
  const stdout = await sessionRecorder.getShell({ sudo }).exec("echo hi")
  return { stdout, recordedCmds: hostRecord.runningStep?.commands.map(({ cmd }) => cmd) }
}

describe("SessionRecorder.getShell", () => {
  it("should run a sudo: true step's script in sudo sh -s, and record the script without it", async () => {
    expect(await runInStep(true)).toStrictEqual({ stdout: "sudo sh -s\nhi\n", recordedCmds: ["echo hi"] })
  })

  it("should run a step without sudo as it is", async () => {
    expect(await runInStep(false)).toStrictEqual({ stdout: "hi\n", recordedCmds: ["echo hi"] })
  })
})

describe("SessionRecorder steps", () => {
  it("should keep a step as the running step until it finishes, then add it to the step records", async () => {
    const hostRecord = createHostRecord("a", "@local")
    const sessionRecorder = createSessionRecorder(hostRecord, { sudo: false }, transport)
    sessionRecorder.startStep("a", "file")
    await sessionRecorder.getShell({ sudo: false }).exec("echo hi")
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

    const stepRecord: StepRecord = { name: "a", kind: "file", commands: [], comparisons: {}, waitingOn: [] }
    expect([hostRecord.runningStep, hostRecord.stepRecords, hostRecord.failure]).toStrictEqual([
      undefined,
      [],
      { kind: "step", stepRecord, error, hints: [] },
    ])
  })
})
