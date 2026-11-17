import { describe, expect, it } from "bun:test"
import path from "node:path"
import process from "node:process"

import { isErr, messageChain } from "ts-explicit-errors"

import type { HostFunction } from "#core/hosts/host.ts"
import type { LoadedHost } from "#core/hosts/load.ts"
import { loadHosts, selectHosts } from "#core/hosts/load.ts"

const FIXTURES = path.resolve(import.meta.dir, "fixtures")

// oxlint-disable-next-line typescript/no-unsafe-assignment - `expect.any()` is typed as `any`
const ANY_FUNCTION: HostFunction = expect.any(Function)

const toFile = (dir: string, name: string) => path.join(FIXTURES, dir, `${name}.ts`)

/** Returns `file` as the load errors show it, relative to the working directory. */
const toDisplayedFile = (file: string) => path.relative(process.cwd(), file)

/** Loads the host scripts and returns their loaded hosts, or the error's message chain. */
const loadOrMessage = async (files: string[]) => {
  const loadedHosts = await loadHosts(files)
  return isErr(loadedHosts) ? messageChain(loadedHosts) : loadedHosts
}

/** Loads the hosts in the `hosts` fixture, or throws why they couldn't load. */
const loadFixtureHosts = async (): Promise<LoadedHost[]> => {
  const loadedHosts = await loadHosts(["a", "b", "c"].map((name) => toFile("hosts", name)))
  if (isErr(loadedHosts)) throw loadedHosts
  return loadedHosts
}

/** Picks hosts by name, and returns their names, or the error's message chain. */
const selectOrMessage = async (names: string[]) => {
  const selectedHosts = selectHosts(await loadFixtureHosts(), names)
  return isErr(selectedHosts) ? messageChain(selectedHosts) : selectedHosts.map(({ name }) => name)
}

describe("loadHosts", () => {
  it("should return each host script's loaded host, named by its config", async () => {
    expect(await loadOrMessage([toFile("hosts", "a"), toFile("hosts", "b")])).toStrictEqual([
      { name: "a", target: "a.lan", options: { sudo: false }, fn: ANY_FUNCTION },
      { name: "b", target: "b.lan", options: { sudo: false }, fn: ANY_FUNCTION },
    ])
  })

  it("should list every host script that fails to load", async () => {
    const brokenFiles = ["throws", "no-default", "not-host", "invalid-sudo", "empty-sudo-password", "bad-name"].map(
      (name) => toFile("broken", name),
    )
    const [throws, noDefault, notHost, invalidSudo, emptySudoPassword, badName] = brokenFiles.map(toDisplayedFile)

    expect(await loadOrMessage([toFile("hosts", "a"), ...brokenFiles])).toBe(
      [
        "failed to load hosts:",
        `failed to load '${throws}' -> boom`,
        `failed to load '${noDefault}' -> default must be an object (was missing)`,
        `failed to load '${notHost}' -> default.config must be an object (was missing)`,
        "default.fn must be a function (was missing)",
        `failed to load '${invalidSudo}' -> default.config.sudo must be an object or boolean (was a string)`,
        `failed to load '${emptySudoPassword}' -> default.config.sudo.password must be non-empty`,
        `failed to load '${badName}' -> default.config.name must be a name of letters, digits, '.', '_', and '-', starting with a letter or a digit (was "my host")`,
      ].join("\n"),
    )
  })

  it("should fail when more than one host script defines the same host", async () => {
    const files = [toFile("repeated", "one"), toFile("repeated", "two")]

    expect(await loadOrMessage(files)).toBe(
      `failed to load hosts:\nmore than one host script defines the host 'web': ${files.map((file) => `'${toDisplayedFile(file)}'`).join(", ")}`,
    )
  })
})

describe("selectHosts", () => {
  it("should return every host when no names are given", async () => {
    expect(await selectOrMessage([])).toStrictEqual(["a", "b", "c"])
  })

  it("should return only the named hosts, in their scripts' order", async () => {
    expect(await selectOrMessage(["c", "a"])).toStrictEqual(["a", "c"])
  })

  it("should fail on unknown hosts and list the real ones", async () => {
    expect(await selectOrMessage(["a", "nope", "other"])).toBe("unknown host 'nope', 'other' (hosts: 'a', 'b', 'c')")
  })
})
