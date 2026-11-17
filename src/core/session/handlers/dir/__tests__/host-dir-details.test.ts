import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { parseDirDetailsOutput } from "#core/session/handlers/dir/host-dir-details.ts"

const toDetails = (stdout: string) => {
  const details = parseDirDetailsOutput(stdout, "/tmp/x")
  return isErr(details) ? messageChain(details) : details
}

// Cover what a real shell can't easily produce here. The real command runs in `dir.test.ts`.
describe("parseDirDetailsOutput", () => {
  it("should read a directory's mode and owner", () => {
    expect(toDetails("kind=directory\n2750 501 20 adam staff\n")).toMatchObject({
      kind: "existing",
      path: "/tmp/x",
      attributes: { mode: 0o2750, uid: 501, gid: 20, user: "adam", group: "staff" },
    })
  })

  it("should return new details when nothing is at the path", () => {
    expect(toDetails("kind=absent\n")).toStrictEqual({ kind: "new", path: "/tmp/x" })
  })

  it("should fail on a kind it doesn't know", () => {
    expect(toDetails("kind=socket\n")).toBe(
      "the directory details script printed 'kind=socket' instead of what is at the path",
    )
  })

  it("should fail on a stat line without a mode and an owner", () => {
    expect(toDetails("kind=directory\n501 20\n")).toBe(
      "the directory details script printed '501 20' instead of the directory's mode and owner",
    )
  })
})
