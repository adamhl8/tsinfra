import { describe, expect, it } from "bun:test"

import { createFakeSudoSession, readOrMessage } from "#__tests__/session.ts"
import { runLocal } from "#transport/local.ts"
import { createSudoTransport } from "#transport/sudo.ts"

// Stand in for `sudo` with a shell function, so the script still runs in a real nested `sh -s`.
const sudoTransport = createSudoTransport(async (script) => runLocal(`sudo() { "$@"; }\n${script}`))

describe("withSudoPreamble", () => {
  it("should add -n to a script's own sudo, and stay off the record", async () => {
    const { hostSession, readSudoCalls } = await createFakeSudoSession("plan")

    expect(await readOrMessage(hostSession.host, "sudo echo hi")).toBe("hi")
    expect(await readSudoCalls()).toStrictEqual(["-n echo hi"])
    expect(hostSession.stepRecords[0]?.commands[0]?.cmd).toBe("sudo echo hi")
  })
})

describe("createSudoTransport", () => {
  it("should keep a command from reading the rest of the script as its stdin", async () => {
    expect(await sudoTransport("cat\necho after")).toStrictEqual({ stdout: "after\n", stderr: "", exitCode: 0 })
  })

  it("should give the exit code of the script it runs", async () => {
    expect(await sudoTransport("set -eu\nfalse\necho not-reached")).toStrictEqual({
      stdout: "",
      stderr: "",
      exitCode: 1,
    })
  })
})
