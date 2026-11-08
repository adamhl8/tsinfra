import { describe, expect, it } from "bun:test"
import { readdir, stat } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import { createFakeSudoSession, readOrMessage, writeFakeTool } from "#__tests__/session.ts"
import { runLocal } from "#transport/local.ts"
import { WRITE_ASKPASS_HELPER_SCRIPT, createAskpassSudoTransport, createRootTransport } from "#transport/sudo.ts"

const OCTAL_RADIX = 8

// Stand in for `sudo` with a shell function, so the script still runs in a real nested `sh -s`.
const rootTransport = createRootTransport(async (cmd) => runLocal(`sudo() { "$@"; }\n${cmd}`))

/** Runs `script` with `home` as `$HOME`, so the askpass helper goes under it instead of the real home. */
const runInHome = async (home: string, cmd: string) => runLocal(`HOME='${home}'\n${cmd}`)

describe("createPasswordlessSudoTransport", () => {
  it("should add -n to a script's own sudo, and stay off the record", async () => {
    const { hostSession, readSudoCalls } = await createFakeSudoSession("plan")

    expect(await readOrMessage(hostSession.host, "sudo echo hi")).toBe("hi")
    expect(await readSudoCalls()).toStrictEqual(["-n echo hi"])
    expect(hostSession.stepRecords[0]?.commands[0]?.cmd).toBe("sudo echo hi")
  })
})

describe("createAskpassSudoTransport", () => {
  it("should give sudo the password through the helper in ~/.tsinfra", async () => {
    const home = await makeTempDir()
    const binDir = await makeTempDir()
    const password = `it's "a" $HOME`
    // Stand in for `sudo` with a tool that prints what the helper gives it, then runs the command.
    await writeFakeTool(
      binDir,
      "sudo",
      '[ "$1" = -A ] && shift\nprintf \'password: %s\\n\' "$("$SUDO_ASKPASS")"\nexec "$@"',
    )
    const askpassTransport = createAskpassSudoTransport(runLocal, password)

    expect(await runInHome(home, WRITE_ASKPASS_HELPER_SCRIPT)).toStrictEqual({ stdout: "", stderr: "", exitCode: 0 })
    expect((await stat(path.join(home, ".tsinfra", "askpass.sh"))).mode.toString(OCTAL_RADIX)).toEndWith("700")
    // Set `HOME` in the script, because the `sudo` function reads it when it runs.
    expect(await askpassTransport(`HOME='${home}'\nPATH='${binDir}':"$PATH"\nsudo echo hi`)).toStrictEqual({
      stdout: `password: ${password}\nhi\n`,
      stderr: "",
      exitCode: 0,
    })
  })

  it("should replace the helper from an earlier run, and leave nothing else in ~/.tsinfra", async () => {
    const home = await makeTempDir()
    await runInHome(home, WRITE_ASKPASS_HELPER_SCRIPT)

    expect(await runInHome(home, WRITE_ASKPASS_HELPER_SCRIPT)).toStrictEqual({ stdout: "", stderr: "", exitCode: 0 })
    expect(await readdir(path.join(home, ".tsinfra"))).toStrictEqual(["askpass.sh"])
  })
})

describe("createRootTransport", () => {
  it("should keep a command from reading the rest of the script as its stdin", async () => {
    expect(await rootTransport("cat\necho after")).toStrictEqual({ stdout: "after\n", stderr: "", exitCode: 0 })
  })

  it("should give the exit code of the script it runs", async () => {
    expect(await rootTransport("set -eu\nfalse\necho not-reached")).toStrictEqual({
      stdout: "",
      stderr: "",
      exitCode: 1,
    })
  })
})
