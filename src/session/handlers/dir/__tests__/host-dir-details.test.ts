import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { parseDirDetailsOutput } from "#session/handlers/dir/host-dir-details.ts"

const toDetails = (stdout: string) => {
  const details = parseDirDetailsOutput(stdout, "/tmp/x")
  return isErr(details) ? messageChain(details) : details
}

// Cover what a real shell can't easily produce here. The real command runs in `dir.test.ts`.
describe("parseDirDetailsOutput", () => {
  it("should fail on output that doesn't say what is at the path", () => {
    expect(toDetails("hello\n")).toBe("the directory details script printed 'hello' instead of what is at the path")
  })
})
