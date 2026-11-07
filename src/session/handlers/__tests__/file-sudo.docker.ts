import { beforeAll, describe, expect, it } from "bun:test"
import crypto from "node:crypto"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { $, CryptoHasher } from "bun"

import { createSession, fileOrMessage } from "#__tests__/session.ts"
import type { Host } from "#session/session.ts"

const ROOT_OWNED_DIR = "/etc/tsinfra-docker"
const CONTENT_LIMIT_BYTES = 10_000_000
const RANDOM_CHUNK_BYTES = 65_536

const getModeAndOwner = async (filePath: string) => (await $`sudo stat -c '%a %U %G' ${filePath}`.text()).trim()
const readAsRoot = async (filePath: string) => $`sudo cat ${filePath}`.text()
const getTempFiles = async () => {
  const names = await $`sudo ls -A ${ROOT_OWNED_DIR}`.text()
  return names.split("\n").filter((name) => name.includes(".tsinfra."))
}

/** Writes `content` to a root-owned `filePath` as root, without going through `h.file`. */
const writeAsRoot = async (filePath: string, content: string, mode: string) =>
  $`sudo sh -c ${`printf '%s' '${content}' > '${filePath}' && chmod ${mode} '${filePath}'`}`

/** Runs `h.file` in a new session, like a later run of the script. */
const applyFile = async (...fileArgs: Parameters<Host["file"]>) => {
  const { host: h } = await createSession("apply")
  return fileOrMessage(h, ...fileArgs)
}

const createRandomBytes = (size: number) => {
  const bytes = new Uint8Array(size)
  for (let index = 0; index < size; index += RANDOM_CHUNK_BYTES)
    crypto.getRandomValues(bytes.subarray(index, index + RANDOM_CHUNK_BYTES))

  return bytes
}

beforeAll(async () => {
  await $`sudo mkdir -p ${ROOT_OWNED_DIR}`
})

describe("h.file with real sudo", () => {
  it("should write a new root-owned file, and be unchanged on the next apply", async () => {
    const filePath = `${ROOT_OWNED_DIR}/new.conf`

    expect(await applyFile(filePath, "a\n", { sudo: true })).toMatchObject({ changed: true })
    expect(await getModeAndOwner(filePath)).toBe("644 root root")
    expect(await readAsRoot(filePath)).toBe("a\n")
    expect(await applyFile(filePath, "a\n", { sudo: true })).toMatchObject({ changed: false })
  })

  it("should give a file to another user and group, and keep them on an update", async () => {
    const filePath = `${ROOT_OWNED_DIR}/owned.conf`

    await applyFile(filePath, "a\n", { sudo: true, user: "sonarr", group: "sonarr", mode: "640" })
    expect(await getModeAndOwner(filePath)).toBe("640 sonarr sonarr")

    await applyFile(filePath, "b\n", { sudo: true })
    expect(await getModeAndOwner(filePath)).toBe("640 sonarr sonarr")
    expect(await readAsRoot(filePath)).toBe("b\n")
  })

  it("should keep setuid, because chown runs before chmod", async () => {
    const filePath = `${ROOT_OWNED_DIR}/setuid`

    await applyFile(filePath, "#!/bin/sh\n", { sudo: true, user: "sonarr", mode: "4755" })

    expect(await getModeAndOwner(filePath)).toBe("4755 sonarr root")
  })

  it("should diff a root-only file", async () => {
    const filePath = `${ROOT_OWNED_DIR}/private`
    await writeAsRoot(filePath, "old\n", "600")
    const hostSession = await createSession("plan")

    await fileOrMessage(hostSession.host, filePath, "new\n", { sudo: true })

    expect(hostSession.stepRecords[0]?.comparisons.before?.values).toStrictEqual({
      kind: "file",
      content: { kind: "text", got: "old\n", want: "new\n" },
      attributeChanges: [],
    })
  })

  // Cover the modes `stat -c %a` prints without padding, where `044` reads as `44`.
  it.each(["000", "004", "044"])("should read a file with mode %s", async (mode) => {
    const filePath = `${ROOT_OWNED_DIR}/mode-${mode}`
    await writeAsRoot(filePath, "old\n", mode)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "new\n", { sudo: true })).toMatchObject({ changed: true })
  })

  it("should give created parent directories the usual permissions, despite the umask", async () => {
    const filePath = `${ROOT_OWNED_DIR}/deep/er/app.conf`

    await applyFile(filePath, "a\n", { sudo: true })

    expect(await getModeAndOwner(`${ROOT_OWNED_DIR}/deep/er`)).toBe("755 root root")
  })

  it("should make a new secret file private", async () => {
    const filePath = `${ROOT_OWNED_DIR}/secret`

    await applyFile(filePath, "a\n", { sudo: true, secret: true })

    expect(await getModeAndOwner(filePath)).toBe("600 root root")
  })

  it("should write 10 MB of binary content intact", async () => {
    const filePath = `${ROOT_OWNED_DIR}/big.bin`
    const bytes = createRandomBytes(CONTENT_LIMIT_BYTES)

    expect(await applyFile(filePath, bytes, { sudo: true })).toMatchObject({ changed: true })

    const [hostHash] = (await $`sudo sha256sum ${filePath}`.text()).split(" ")
    expect(hostHash).toBe(new CryptoHasher("sha256").update(bytes).digest("hex"))
  })

  it("should write to a path with a quote and a newline", async () => {
    const filePath = `${ROOT_OWNED_DIR}/it's a\nnew line`

    await applyFile(filePath, "a\n", { sudo: true })

    expect(await readAsRoot(filePath)).toBe("a\n")
  })

  it("should leave the file alone when the write fails", async () => {
    const filePath = `${ROOT_OWNED_DIR}/failed.conf`
    await writeAsRoot(filePath, "old\n", "640")

    expect(await applyFile(filePath, "new\n", { sudo: true, user: "nosuchuser" })).toContain(
      `failed to write '${filePath}'`,
    )
    expect(await getModeAndOwner(filePath)).toBe("640 root root")
    expect(await readAsRoot(filePath)).toBe("old\n")
    expect(await getTempFiles()).toStrictEqual([])
  })
})

describe("h.file validate with real sudo", () => {
  it("should run the validate command as root", async () => {
    const filePath = `${ROOT_OWNED_DIR}/validated`

    const result = await applyFile(filePath, "a\n", {
      sudo: true,
      validate: (tempPath) => `test "$(id -u)" = 0 && test -s ${tempPath}`,
    })

    expect(result).toMatchObject({ changed: true })
    expect(await readAsRoot(filePath)).toBe("a\n")
  })
})

describe("h.file without sudo, as a user who could use it", () => {
  it("should refuse another user", async () => {
    const filePath = path.join(await makeTempDir(), "app.conf")
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "a\n", { user: "sonarr" })).toBe(
      "failed to compare the host with what the step wants -> user 'sonarr' needs sudo: true, because only root can change a file's owner to another user",
    )
  })

  it("should refuse a file someone else owns, and write it with sudo", async () => {
    const filePath = path.join(await makeTempDir(), "owned-by-sonarr")
    await $`sudo sh -c ${`echo old > ${filePath} && chown sonarr:sonarr ${filePath} && chmod 644 ${filePath}`}`
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "new\n")).toBe(
      `failed to compare the host with what the step wants -> '${filePath}' is owned by 'sonarr', so writing it needs sudo: true`,
    )

    await applyFile(filePath, "new\n", { sudo: true })
    expect(await getModeAndOwner(filePath)).toBe("644 sonarr sonarr")
  })

  it("should say a root-only file needs sudo", async () => {
    const filePath = `${ROOT_OWNED_DIR}/root-only`
    await writeAsRoot(filePath, "old\n", "600")
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "new\n")).toBe(
      `failed to compare the host with what the step wants -> can't read '${filePath}' as the SSH user, so it needs sudo: true`,
    )
  })
})
