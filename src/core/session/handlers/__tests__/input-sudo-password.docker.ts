import { describe, expect, it } from "bun:test"

import { createSession, readOrMessage } from "#core/__tests__/session.ts"

// `setup.sh` gives this user this password.
const PASSWORD = "it's tsinfra"

describe("input with sudo that needs a password", () => {
  it("should give the input to a command run with sudo, as root, and keep the password off the record", async () => {
    const hostSession = await createSession("apply", { sudo: { password: PASSWORD } })

    expect(await readOrMessage(hostSession.host, "sudo sh -c 'id -u; cat'", { input: "a\nb" })).toBe("0\na\nb")
    expect(JSON.stringify(hostSession.hostRecord)).not.toContain(PASSWORD)
  })
})
