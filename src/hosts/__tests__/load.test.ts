import { describe, expect, it } from "bun:test"
import path from "node:path"

import { isErr, messageChain } from "ts-explicit-errors"

import type { HostScript } from "#hosts/discover.ts"
import type { HostFunction } from "#hosts/host.ts"
import { loadHosts } from "#hosts/load.ts"

const FIXTURES = path.resolve(import.meta.dir, "fixtures")

// oxlint-disable-next-line typescript/no-unsafe-assignment - `expect.any()` is typed as `any`
const ANY_FUNCTION: HostFunction = expect.any(Function)

const toHostScript = (dir: string, name: string) => ({ name, file: path.join(FIXTURES, dir, `${name}.ts`) })

/** Loads the host scripts and returns their loaded hosts, or the error's message chain. */
const loadOrMessage = async (hostScripts: HostScript[]) => {
  const loadedHosts = await loadHosts(hostScripts)
  return isErr(loadedHosts) ? messageChain(loadedHosts) : loadedHosts
}

describe("loadHosts", () => {
  it("should return each host script's loaded host", async () => {
    const loadedHosts = await loadHosts([toHostScript("hosts", "a"), toHostScript("hosts", "b")])

    expect(loadedHosts).toStrictEqual([
      { name: "a", target: "a.lan", fn: ANY_FUNCTION, options: { sudo: false } },
      { name: "b", target: "b.lan", fn: ANY_FUNCTION, options: { sudo: false } },
    ])
  })

  it("should list every host that fails to load", async () => {
    const hostScripts = [
      toHostScript("hosts", "a"),
      ...["throws", "no-default", "not-host", "invalid-sudo", "empty-sudo-password"].map((name) =>
        toHostScript("broken", name),
      ),
    ]

    expect(await loadOrMessage(hostScripts)).toBe(
      [
        "failed to load hosts:",
        "failed to load host 'throws' -> boom",
        "failed to load host 'no-default' -> default must be an object (was missing)",
        "failed to load host 'not-host' -> default.fn must be a function (was missing)",
        "default.options must be an object (was missing)",
        "failed to load host 'invalid-sudo' -> default.options.sudo must be an object or boolean (was a string)",
        "failed to load host 'empty-sudo-password' -> default.options.sudo.password must be non-empty",
      ].join("\n"),
    )
  })
})
