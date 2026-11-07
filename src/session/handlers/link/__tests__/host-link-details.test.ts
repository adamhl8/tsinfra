import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { parseLinkDetailsOutput } from "#session/handlers/link/host-link-details.ts"

const OWNER = { uid: 501, gid: 20, user: "adam", group: "staff" }
const STAT_LINE = "501 20 adam staff"

const toDetails = (stdout: string) => {
  const details = parseLinkDetailsOutput(stdout, "/tmp/x")
  return isErr(details) ? messageChain(details) : details
}

// Cover what a real shell can't easily produce here. The real command runs in `link.test.ts`.
describe("parseLinkDetailsOutput", () => {
  it("should read a target with a newline, and keep what readlink printed", () => {
    expect(toDetails(`kind=link\n${STAT_LINE}\ntarget=exists\n/a\nb\n`)).toStrictEqual({
      kind: "link",
      path: "/tmp/x",
      targetExists: true,
      currentTarget: "/a\nb",
      owner: OWNER,
    })
  })

  it("should keep a newline at the end of a target", () => {
    expect(toDetails(`kind=link\n${STAT_LINE}\ntarget=exists\n/a\n\n`)).toMatchObject({ currentTarget: "/a\n" })
  })

  it("should fail on a kind it doesn't know", () => {
    expect(toDetails("kind=socket\n")).toBe(
      "the link details command printed 'kind=socket' instead of what is at the path",
    )
  })

  it("should fail on a target line it doesn't know", () => {
    expect(toDetails(`kind=file\n${STAT_LINE}\ntarget=maybe\n`)).toBe(
      "the link details command printed 'target=maybe' instead of whether the target exists",
    )
  })

  it.each(["", "501 20 adam", "501 20 first last staff", "x 20 adam staff"])(
    "should fail on the stat line '%s'",
    (statLine) => {
      expect(toDetails(`kind=file\n${statLine}\ntarget=missing\n`)).toBe(
        `the link details command printed '${statLine}' instead of the owner of the path`,
      )
    },
  )
})
