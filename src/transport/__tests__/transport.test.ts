import { describe, expect, it } from "bun:test"

import { getTransport } from "#transport/transport.ts"

const localTransport = getTransport("@local")

describe("getTransport", () => {
  it("should give commands /dev/null as stdin instead of the rest of the script", async () => {
    expect(await localTransport("cat\necho after")).toStrictEqual({ stdout: "after\n", stderr: "", exitCode: 0 })
  })

  it("should run a script that ends in a comment", async () => {
    expect(await localTransport("echo hi # done")).toStrictEqual({ stdout: "hi\n", stderr: "", exitCode: 0 })
  })
})
