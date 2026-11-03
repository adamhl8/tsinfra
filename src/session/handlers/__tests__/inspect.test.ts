import { describe, expect, it } from "bun:test"

import { createSession, getFailureMessage } from "#__tests__/session.ts"

describe("h.inspect", () => {
  it("should return a non-zero exit without failing the host", async () => {
    const hostSession = await createSession()

    expect(await hostSession.host.inspect("echo out; echo err >&2; exit 3")).toStrictEqual({
      stdout: "out",
      stderr: "err",
      exitCode: 3,
    })
    expect(getFailureMessage(hostSession)).toBeUndefined()
  })

  it("should trim both streams", async () => {
    const { host: h } = await createSession()

    expect(await h.inspect(String.raw`printf '  a  \n\n'; printf ' b \n' >&2`)).toStrictEqual({
      stdout: "a",
      stderr: "b",
      exitCode: 0,
    })
  })
})
