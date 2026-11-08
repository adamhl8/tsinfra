import { describe, expect, it } from "bun:test"

import { createStepShell } from "#session/shell.ts"
import { createStepRecorder } from "#session/step-recorder.ts"
import { runLocal } from "#transport/local.ts"
import type { Transport } from "#transport/transport.ts"

// Stand in for `sudo` with a function that prints the command it's given, then runs it.
const transport: Transport = async (cmd) => runLocal(`sudo() { echo "sudo $*"; "$@"; }\n${cmd}`)

/** Runs `echo hi` in a step on the shell for `sudo`, and returns its stdout and the commands the step recorded. */
const runInStep = async (sudo: boolean) => {
  const { stepRecords, recordCommands, startStep } = createStepRecorder()
  startStep("a", "file")
  const stdout = await createStepShell(transport, recordCommands, sudo).exec("echo hi")
  return { stdout, recordedCmds: stepRecords[0]?.commands.map(({ cmd }) => cmd) }
}

describe("createStepShell", () => {
  it("should run a sudo: true step's script in sudo sh -s, and record the script without it", async () => {
    expect(await runInStep(true)).toStrictEqual({ stdout: "sudo sh -s\nhi\n", recordedCmds: ["echo hi"] })
  })

  it("should run a step without sudo as it is", async () => {
    expect(await runInStep(false)).toStrictEqual({ stdout: "hi\n", recordedCmds: ["echo hi"] })
  })
})
