import { describe, expect, it } from "bun:test"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import { createFakeSudoSession, readOrMessage, writeFakeTool } from "#core/__tests__/session.ts"
import { runLocal } from "#core/transport/local.ts"
import { buildAskpassHelperWriteScript, createAskpassSudoTransport } from "#core/transport/sudo.ts"

const OCTAL_RADIX = 8

// Put a quote and a space in the helper's directory, so a path that isn't quoted breaks the script.
const toHelperPath = async () => path.join(await makeTempDir(), "it's here", "askpass.sh")

describe("createPasswordlessSudoTransport", () => {
  it("should add -n to a script's own sudo, and stay off the record", async () => {
    const { hostSession, readSudoCalls } = await createFakeSudoSession("plan")

    expect(await readOrMessage(hostSession.host, "sudo echo hi")).toBe("hi")
    expect(await readSudoCalls()).toStrictEqual(["-n echo hi"])
    expect(hostSession.hostRecord.stepRecords[0]?.commands[0]?.cmd).toBe("sudo echo hi")
  })
})

describe("createAskpassSudoTransport", () => {
  it("should give sudo the password through the helper at its path", async () => {
    const helperPath = await toHelperPath()
    const binDir = await makeTempDir()
    const password = `it's "a" $HOME`
    // Stand in for `sudo` with a tool that prints what the helper gives it, then runs the command.
    await writeFakeTool(
      binDir,
      "sudo",
      '[ "$1" = -A ] && shift\nprintf \'password: %s\\n\' "$("$SUDO_ASKPASS")"\nexec "$@"',
    )
    const askpassTransport = createAskpassSudoTransport(runLocal, password, helperPath)

    expect(await runLocal(buildAskpassHelperWriteScript(helperPath))).toStrictEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    })
    expect((await stat(helperPath)).mode.toString(OCTAL_RADIX)).toEndWith("700")
    expect(await askpassTransport(`PATH='${binDir}':"$PATH"\nsudo echo hi`)).toStrictEqual({
      stdout: `password: ${password}\nhi\n`,
      stderr: "",
      exitCode: 0,
    })
  })

  it("should replace the helper from an earlier run, and leave nothing else in its directory", async () => {
    const helperPath = await toHelperPath()
    await runLocal(buildAskpassHelperWriteScript(helperPath))

    expect(await runLocal(buildAskpassHelperWriteScript(helperPath))).toStrictEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    })
    expect(await readdir(path.dirname(helperPath))).toStrictEqual(["askpass.sh"])
  })
})
