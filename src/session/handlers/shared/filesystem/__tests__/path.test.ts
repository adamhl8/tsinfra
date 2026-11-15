import { describe, expect, it } from "bun:test"

import { isErr } from "ts-explicit-errors"

import type { HomeDirectory } from "#hosts/hosts.ts"
import { validateHome } from "#hosts/prepare/host-details/host-details.ts"
import { resolveHome } from "#session/handlers/shared/filesystem/path.ts"

/** Returns `rawHome` checked the way preparation checks it, or throws why it isn't a home directory. */
const toHome = (rawHome: string): HomeDirectory => {
  const home = validateHome(rawHome)
  if (isErr(home)) throw home
  return home
}

const HOME = toHome("/home/adam")

describe("resolveHome", () => {
  it("should replace a leading ~/ and a bare ~ with the home directory", () => {
    expect([resolveHome("~/.config/fish", HOME), resolveHome("~", HOME)]).toStrictEqual([
      "/home/adam/.config/fish",
      "/home/adam",
    ])
  })

  it("should leave an absolute path as it is", () => {
    expect(resolveHome("/etc/app.conf", HOME)).toBe("/etc/app.conf")
  })
})
