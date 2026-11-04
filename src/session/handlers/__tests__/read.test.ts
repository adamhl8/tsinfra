import { describe, expect, it } from "bun:test"

import { castInvalid, createSession, getFailureMessage, readOrMessage } from "#__tests__/session.ts"

describe("h.read", () => {
  it("should return stdout trimmed", async () => {
    const hostSession = await createSession()

    expect(await hostSession.host.read(String.raw`printf '  a\nb  \n\n'`)).toBe("a\nb")
  })

  it("should throw and record a failure with the exit code and stderr when the command fails", async () => {
    const hostSession = await createSession()
    const message = "failed to read 'echo oops >&2; exit 3' -> exited with code 3: oops"

    expect(await readOrMessage(hostSession.host, "echo oops >&2; exit 3")).toBe(message)
    expect(getFailureMessage(hostSession)).toBe(message)
  })

  it("should fail the host when the command isn't a string", async () => {
    const { host: h } = await createSession()

    expect(await readOrMessage(h, castInvalid(1))).toBe(
      "failed to validate the command given to 'read' -> must be a string (was a number)",
    )
  })

  it("should leave stderr out of the failure when it's empty", async () => {
    const hostSession = await createSession()

    expect(await readOrMessage(hostSession.host, "exit 1")).toBe("failed to read 'exit 1' -> exited with code 1")
  })
})
