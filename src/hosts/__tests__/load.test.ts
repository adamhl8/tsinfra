import { describe, expect, it } from "bun:test"
import path from "node:path"

import { isErr, messageChain } from "ts-explicit-errors"

import type { HostFile } from "#hosts/discover.ts"
import type { HostFunction } from "#hosts/host.ts"
import { host } from "#hosts/host.ts"
import { loadHosts } from "#hosts/load.ts"

const FIXTURES = path.resolve(import.meta.dir, "fixtures")

// oxlint-disable-next-line typescript/no-unsafe-assignment - `expect.any()` is typed as `any`
const ANY_FUNCTION: HostFunction = expect.any(Function)

const toHostFile = (dir: string, name: string) => ({ name, file: path.join(FIXTURES, dir, `${name}.ts`) })

/** Loads the host files and returns the hosts, or the error's message chain. */
const loadOrMessage = async (hostFiles: HostFile[]) => {
  const hosts = await loadHosts(hostFiles)
  return isErr(hosts) ? messageChain(hosts) : hosts
}

describe("loadHosts", () => {
  it("should return each host with its definition", async () => {
    const hosts = await loadHosts([toHostFile("hosts", "a"), toHostFile("hosts", "b")])

    expect(hosts).toStrictEqual([
      { ...host("a.lan", ANY_FUNCTION), ...toHostFile("hosts", "a") },
      { ...host("b.lan", ANY_FUNCTION), ...toHostFile("hosts", "b") },
    ])
  })

  it("should list every host that fails to load", async () => {
    const hostFiles = [
      toHostFile("hosts", "a"),
      ...["throws", "no-default", "not-host"].map((name) => toHostFile("broken", name)),
    ]

    expect(await loadOrMessage(hostFiles)).toBe(
      [
        "failed to load hosts:",
        "failed to load host 'throws' -> boom",
        "host 'no-default' does not default export host()",
        "host 'not-host' does not default export host()",
      ].join("\n"),
    )
  })
})
