import { describe, expect, it } from "bun:test"

import { createSession, getFailureMessage, readOrMessage } from "#__tests__/session.ts"

describe("h.read", () => {
  it("should return stdout trimmed", async () => {
    const hostSession = createSession()

    expect(await hostSession.host.read(String.raw`printf '  a\nb  \n\n'`)).toBe("a\nb")
  })

  it("should throw and record a failure with the exit code and stderr when the command fails", async () => {
    const hostSession = createSession()
    const message = "failed to read 'echo oops >&2; exit 3' -> exited with code 3: oops"

    expect(await readOrMessage(hostSession.host, "echo oops >&2; exit 3")).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should leave stderr out of the failure when it's empty", async () => {
    const hostSession = createSession()

    expect(await readOrMessage(hostSession.host, "exit 1")).toBe("failed to read 'exit 1' -> exited with code 1")
  })
})
