import { describe, expect, it } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { isErr, messageChain } from "ts-explicit-errors"

import { writeHosts } from "#__tests__/utils.ts"
import { discoverHosts } from "#hosts/discover.ts"

/** Returns the names of the discovered hosts, or the error's message chain. */
const discoverNames = async (dir: string, names: string[] = []) => {
  const hosts = await discoverHosts(dir, names)
  if (isErr(hosts)) return messageChain(hosts)
  return hosts.map(({ name }) => name)
}

describe("discoverHosts", () => {
  it("should return every host, sorted, when none are named", async () => {
    const dir = await makeTempDir("hosts-")
    await writeHosts(dir, ["b", "a"])

    const hosts = await discoverHosts(dir, [])

    expect(hosts).toStrictEqual([
      { name: "a", file: path.join(dir, "a.ts") },
      { name: "b", file: path.join(dir, "b.ts") },
    ])
  })

  it("should return only the named hosts, in file order", async () => {
    const dir = await makeTempDir("hosts-")
    await writeHosts(dir, ["a", "b", "c"])

    expect(await discoverNames(dir, ["c", "a"])).toStrictEqual(["a", "c"])
  })

  it("should ignore files that aren't host files", async () => {
    const dir = await makeTempDir("hosts-")
    await writeHosts(dir, ["a"])
    await writeHosts(path.join(dir, "lib"), ["b"])
    await Bun.write(path.join(dir, "notes.md"), "")

    expect(await discoverNames(dir)).toStrictEqual(["a"])
  })

  it("should fail on unknown hosts and list the real ones", async () => {
    const dir = await makeTempDir("hosts-")
    await writeHosts(dir, ["a", "b"])

    expect(await discoverNames(dir, ["a", "nope", "other"])).toBe("unknown host 'nope', 'other' (hosts: 'a', 'b')")
  })

  it("should fail when the directory is missing", async () => {
    const dir = path.join(await makeTempDir("hosts-"), "missing")

    expect(await discoverNames(dir)).toStartWith(`failed to read hosts directory '${dir}' -> ENOENT`)
  })

  it("should fail when the directory has no host files", async () => {
    const dir = await makeTempDir("hosts-")
    await fs.mkdir(path.join(dir, "lib"))

    expect(await discoverNames(dir)).toBe(`no host files in '${dir}'`)
  })
})
