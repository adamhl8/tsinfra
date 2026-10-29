import { describe, expect, it } from "bun:test"
import path from "node:path"

import { isErr, messageChain } from "ts-explicit-errors"

import { discoverHosts } from "#hosts/discover.ts"

const FIXTURES = path.resolve(import.meta.dir, "fixtures")
const HOSTS_DIR = path.join(FIXTURES, "hosts")

/** Returns the names of the discovered hosts, or the error's message chain. */
const discoverNames = async (dir: string, names: string[] = []) => {
  const hosts = await discoverHosts(dir, names)
  if (isErr(hosts)) return messageChain(hosts)
  return hosts.map(({ name }) => name)
}

describe("discoverHosts", () => {
  it("should return every host file, sorted, ignoring subdirectories and other files", async () => {
    const hosts = await discoverHosts(HOSTS_DIR, [])

    expect(hosts).toStrictEqual(["a", "b", "c"].map((name) => ({ name, file: path.join(HOSTS_DIR, `${name}.ts`) })))
  })

  it("should return only the named hosts, in file order", async () => {
    expect(await discoverNames(HOSTS_DIR, ["c", "a"])).toStrictEqual(["a", "c"])
  })

  it("should fail on unknown hosts and list the real ones", async () => {
    expect(await discoverNames(HOSTS_DIR, ["a", "nope", "other"])).toBe(
      "unknown host 'nope', 'other' (hosts: 'a', 'b', 'c')",
    )
  })

  it("should fail when the directory is missing", async () => {
    const dir = path.join(FIXTURES, "missing")

    expect(await discoverNames(dir)).toStartWith(`failed to read hosts directory '${dir}' -> ENOENT`)
  })

  it("should fail when the directory has no host files", async () => {
    const dir = path.join(FIXTURES, "no-hosts")

    expect(await discoverNames(dir)).toBe(`no host files in '${dir}'`)
  })
})
