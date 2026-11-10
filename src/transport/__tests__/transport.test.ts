import { describe, expect, it } from "bun:test"

import { getLocalTransport } from "#transport/transport.ts"

const localTransport = getLocalTransport()

describe("getLocalTransport", () => {
  it("should give commands /dev/null as stdin instead of the rest of the script", async () => {
    expect(await localTransport("cat\necho after")).toStrictEqual({ stdout: "after\n", stderr: "", exitCode: 0 })
  })

  it("should run a script that ends in a comment", async () => {
    expect(await localTransport("echo hi # done")).toStrictEqual({ stdout: "hi\n", stderr: "", exitCode: 0 })
  })
})
