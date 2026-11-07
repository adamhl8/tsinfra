import { beforeAll, describe, expect, it } from "bun:test"

import { $ } from "bun"

import { createSession, fileOrMessage } from "#__tests__/session.ts"
import type { Host } from "#session/session.ts"

const DIR = "/etc/tsinfra-docker"
const TEN_MB = 10_000_000
const RANDOM_CHUNK_BYTES = 65_536

const getStat = async (filePath: string) => (await $`sudo stat -c '%a %U %G' ${filePath}`.text()).trim()
const readAsRoot = async (filePath: string) => $`sudo cat ${filePath}`.text()
const getTempFiles = async () => {
  const names = await $`sudo ls -A ${DIR}`.text()
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
  await $`sudo mkdir -p ${DIR}`
})

describe("h.file with real sudo", () => {
  it("should write a new root-owned file, and be unchanged on the next apply", async () => {
    const filePath = `${DIR}/new.conf`

    expect(await applyFile(filePath, "a\n", { sudo: true })).toMatchObject({ changed: true })
    expect(await getStat(filePath)).toBe("644 root root")
    expect(await readAsRoot(filePath)).toBe("a\n")
    expect(await applyFile(filePath, "a\n", { sudo: true })).toMatchObject({ changed: false })
  })

  it("should give a file to another user and group, and keep them on an update", async () => {
    const filePath = `${DIR}/owned.conf`

    await applyFile(filePath, "a\n", { sudo: true, user: "sonarr", group: "sonarr", mode: "640" })
    expect(await getStat(filePath)).toBe("640 sonarr sonarr")

    await applyFile(filePath, "b\n", { sudo: true })
    expect(await getStat(filePath)).toBe("640 sonarr sonarr")
    expect(await readAsRoot(filePath)).toBe("b\n")
  })

  it("should keep setuid, because chown runs before chmod", async () => {
    const filePath = `${DIR}/setuid`

    await applyFile(filePath, "#!/bin/sh\n", { sudo: true, user: "sonarr", mode: "4755" })

    expect(await getStat(filePath)).toBe("4755 sonarr root")
  })

  it("should diff a root-only file", async () => {
    const filePath = `${DIR}/private`
    await writeAsRoot(filePath, "old\n", "600")
    const hostSession = await createSession("plan")

    await fileOrMessage(hostSession.host, filePath, "new\n", { sudo: true })

    expect(hostSession.stepRecords[0]?.comparisons.before?.values).toStrictEqual({
      kind: "file",
      content: { kind: "text", got: "old\n", want: "new\n" },
      attributes: [],
    })
  })

  // `stat -c %a` prints these without padding, so `044` reads as `44`.
  it.each(["000", "004", "044"])("should read a file with mode %s", async (mode) => {
    const filePath = `${DIR}/mode-${mode}`
    await writeAsRoot(filePath, "old\n", mode)
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "new\n", { sudo: true })).toMatchObject({ changed: true })
  })

  it("should give created parent directories the usual permissions, despite the umask", async () => {
    const filePath = `${DIR}/deep/er/app.conf`

    await applyFile(filePath, "a\n", { sudo: true })

    expect(await getStat(`${DIR}/deep/er`)).toBe("755 root root")
  })

  it("should make a new secret file private", async () => {
    const filePath = `${DIR}/secret`

    await applyFile(filePath, "a\n", { sudo: true, secret: true })

    expect(await getStat(filePath)).toBe("600 root root")
  })

  it("should write 10 MB of binary content intact", async () => {
    const filePath = `${DIR}/big.bin`
    const bytes = createRandomBytes(TEN_MB)

    expect(await applyFile(filePath, bytes, { sudo: true })).toMatchObject({ changed: true })

    const [hostHash] = (await $`sudo sha256sum ${filePath}`.text()).split(" ")
    expect(hostHash).toBe(new Bun.CryptoHasher("sha256").update(bytes).digest("hex"))
  })

  it("should write to a path with a quote and a newline", async () => {
    const filePath = `${DIR}/it's a\nnew line`

    await applyFile(filePath, "a\n", { sudo: true })

    expect(await readAsRoot(filePath)).toBe("a\n")
  })

  it("should leave the file alone when the write fails", async () => {
    const filePath = `${DIR}/failed.conf`
    await writeAsRoot(filePath, "old\n", "640")

    expect(await applyFile(filePath, "new\n", { sudo: true, user: "nosuchuser" })).toContain(
      `failed to write '${filePath}'`,
    )
    expect(await getStat(filePath)).toBe("640 root root")
    expect(await readAsRoot(filePath)).toBe("old\n")
    expect(await getTempFiles()).toStrictEqual([])
  })
})

describe("h.file without sudo, as a user who could use it", () => {
  it("should refuse another user", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/tmp/refused-user", "a\n", { user: "sonarr" })).toBe(
      "failed to compare the host with what the step wants -> user 'sonarr' needs sudo: true, because only root can change a file's owner to another user",
    )
  })

  it("should refuse a file someone else owns, and write it with sudo", async () => {
    const filePath = "/tmp/owned-by-sonarr"
    await $`sudo sh -c ${`echo old > ${filePath} && chown sonarr:sonarr ${filePath} && chmod 644 ${filePath}`}`
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "new\n")).toBe(
      `failed to compare the host with what the step wants -> '${filePath}' is owned by 'sonarr', so writing it needs sudo: true`,
    )

    await applyFile(filePath, "new\n", { sudo: true })
    expect(await getStat(filePath)).toBe("644 sonarr sonarr")
  })

  it("should say a root-only file needs sudo", async () => {
    const filePath = `${DIR}/root-only`
    await writeAsRoot(filePath, "old\n", "600")
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, filePath, "new\n")).toBe(
      `failed to compare the host with what the step wants -> can't read '${filePath}' as the SSH user, so it needs sudo: true`,
    )
  })
})
