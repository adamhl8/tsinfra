import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { toBytes } from "#session/handlers/file/bytes.ts"
import { parseStateOutput } from "#session/handlers/file/state-command.ts"

const HASH = "a".repeat(64)

const toFindings = (stdout: string) => {
  const findings = parseStateOutput(stdout)
  return isErr(findings) ? messageChain(findings) : findings
}

describe("parseStateOutput", () => {
  it("should read GNU's hash and stat line", () => {
    expect(toFindings(`kind=file\n${HASH}  -\n644 501 20 adam staff 12\n`)).toStrictEqual({
      kind: "file",
      hostFile: { hash: HASH, mode: 0o644, uid: 501, gid: 20, user: "adam", group: "staff", size: toBytes(12) },
    })
  })

  it("should read BSD's bare hash and its zero-padded mode, setuid included", () => {
    expect(toFindings(`kind=file\n${HASH}\n04755 0 0 root wheel 3\n`)).toStrictEqual({
      kind: "file",
      hostFile: { hash: HASH, mode: 0o4755, uid: 0, gid: 0, user: "root", group: "wheel", size: toBytes(3) },
    })
  })

  it("should fail on a kind it doesn't know", () => {
    expect(toFindings("kind=socket\n")).toBe(
      "the file's state command printed 'kind=socket' instead of what is at the path",
    )
  })

  it.each([
    "not a stat line",
    "644",
    "644 1000",
    "644 1000 1000 adam",
    "644 1000 1000 adam staff",
    "644 1000 1000 first last staff 15",
    "644 1000 1000 adam staff 0x10",
    "999 1000 1000 adam staff 15",
  ])("should fail on the stat line '%s'", (statLine) => {
    expect(toFindings(`kind=file\n${HASH}\n${statLine}\n`)).toBe(
      `the file's state command printed '${statLine}' instead of the file's mode, owner, and size`,
    )
  })

  it("should fail when no sha256 command printed a hash", () => {
    expect(toFindings("kind=file\n\n644 0 0 root root 3\n")).toBe(
      "the file's state command found no sha256 command (sha256sum, shasum, or sha256) on the host",
    )
  })
})
