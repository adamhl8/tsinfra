import { afterAll, beforeAll, describe, expect, it } from "bun:test"

import { CONTENT_LIMIT_BYTES, createRandomBytes, hashBytes } from "#core/__tests__/content.ts"
import { createSessionOn, ensureOrMessage, readOrMessage } from "#core/__tests__/session.ts"
import { SSHD_TARGET, startSshd, stopSshd } from "#core/__tests__/sshd.ts"
import { closeConnections } from "#core/transport.ts"

// Hash on the host, so the input's bytes are checked without sending them back over ssh.
const HASH_STDIN = "sha256sum | cut -d ' ' -f 1"

beforeAll(async () => {
  await startSshd()
})

afterAll(async () => {
  await closeConnections([SSHD_TARGET])
  await stopSshd()
})

// Check the input over ssh, because ssh hands the script to the host's `sh` in pieces as it arrives.
describe("input over ssh", () => {
  it("should give h.read 10 MB of binary input intact", async () => {
    const { host: h } = await createSessionOn(SSHD_TARGET, "apply")
    const input = createRandomBytes(CONTENT_LIMIT_BYTES)

    expect(await readOrMessage(h, HASH_STDIN, { input })).toBe(hashBytes(input))
  })

  it("should give a tool 10 MB of binary input intact", async () => {
    const { host: h } = await createSessionOn(SSHD_TARGET, "plan")
    const input = createRandomBytes(CONTENT_LIMIT_BYTES)
    const result = await ensureOrMessage(h, {
      want: hashBytes(input),
      check: async ({ read }) => read(HASH_STDIN, { input }),
      fix: "true",
    })

    // Expect no change, which `plan` gives only when the check's hash matched.
    expect(result).toMatchObject({ changed: false })
  })

  // Send more than the 64 KB pipe buffer, so `base64` is still writing when `true` exits.
  it("should succeed with an empty stderr when the command never reads its stdin", async () => {
    const { host: h } = await createSessionOn(SSHD_TARGET, "apply")
    const input = createRandomBytes(1_000_000)

    expect(await h.inspect("true", { input })).toStrictEqual({ stdout: "", stderr: "", exitCode: 0 })
  })
})
