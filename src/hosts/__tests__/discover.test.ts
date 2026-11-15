import { describe, expect, it } from "bun:test"
import path from "node:path"

import { isErr, messageChain } from "ts-explicit-errors"

import { discoverHostScripts } from "#hosts/discover.ts"

const FIXTURES = path.resolve(import.meta.dir, "fixtures")
const HOSTS_DIR = path.join(FIXTURES, "hosts")

/** Returns the discovered host scripts, or the error's message chain. */
const discoverOrMessage = async (dir: string) => {
  const hostScripts = await discoverHostScripts(dir)
  return isErr(hostScripts) ? messageChain(hostScripts) : hostScripts
}

describe("discoverHostScripts", () => {
  it("should return every host script, sorted, ignoring subdirectories and other files", async () => {
    expect(await discoverOrMessage(HOSTS_DIR)).toStrictEqual(
      ["a", "b", "c"].map((name) => path.join(HOSTS_DIR, `${name}.ts`)),
    )
  })

  it("should fail when the directory is missing", async () => {
    const dir = path.join(FIXTURES, "missing")

    expect(await discoverOrMessage(dir)).toStartWith(`failed to read hosts directory '${dir}' -> ENOENT`)
  })

  it("should fail when the directory has no host scripts", async () => {
    const dir = path.join(FIXTURES, "no-hosts")

    expect(await discoverOrMessage(dir)).toBe(`no host scripts in '${dir}'`)
  })
})
