import { describe, expect, it } from "bun:test"

import { createHostRecorder } from "#session/recorder/recorder.ts"
import { createStepShell } from "#session/step-shell.ts"
import { runLocal } from "#transport/local.ts"
import type { Transport } from "#transport/transport.ts"

// Stand in for `sudo` with a function that prints the command it's given, then runs it.
const transport: Transport = async (cmd) => runLocal(`sudo() { echo "sudo $*"; "$@"; }\n${cmd}`)

/** Runs `echo hi` in a step on the shell for `sudo`, and returns its stdout and the commands the step recorded. */
const runInStep = async (sudo: boolean) => {
  const { hostRecord, stepRecorder } = createHostRecorder("a", "@local", { sudo: false })
  stepRecorder.startStep("a", "file")
  const stdout = await createStepShell(transport, stepRecorder.recordCommands, sudo).exec("echo hi")
  return { stdout, recordedCmds: hostRecord.stepRecords[0]?.commands.map(({ cmd }) => cmd) }
}

describe("createStepShell", () => {
  it("should run a sudo: true step's script in sudo sh -s, and record the script without it", async () => {
    expect(await runInStep(true)).toStrictEqual({ stdout: "sudo sh -s\nhi\n", recordedCmds: ["echo hi"] })
  })

  it("should run a step without sudo as it is", async () => {
    expect(await runInStep(false)).toStrictEqual({ stdout: "hi\n", recordedCmds: ["echo hi"] })
  })
})
