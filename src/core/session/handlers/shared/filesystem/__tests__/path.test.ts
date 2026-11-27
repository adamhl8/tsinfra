import { describe, expect, it } from "bun:test"

import { isErr } from "ts-explicit-errors"

import type { HomeDirectory } from "#core/hosts/prepare/host-details/facts/home.ts"
import { validateHome } from "#core/hosts/prepare/host-details/facts/home.ts"
import { resolvePath } from "#core/session/handlers/shared/filesystem/path.ts"

/** Returns `rawHome` checked the way preparation checks it, or throws why it isn't a home directory. */
const toHome = (rawHome: string): HomeDirectory => {
  const home = validateHome(rawHome)
  if (isErr(home)) throw home
  return home
}

const HOME = toHome("/home/adam")

describe("resolvePath", () => {
  it.each([
    ["~/.config/fish", "/home/adam/.config/fish"],
    ["~", "/home/adam"],
    ["~/", "/home/adam"],
    ["/etc/app.conf", "/etc/app.conf"],
    ["/etc//app/./app.conf", "/etc/app/app.conf"],
    ["/etc/app/", "/etc/app"],
    ["/", "/"],
  ])("should resolve '%s' to '%s'", (writtenPath, resolvedPath) => {
    expect(resolvePath(writtenPath, HOME)).toBe(resolvedPath)
  })

  it("should resolve ~/ against a home of /", () => {
    expect([resolvePath("~/x", toHome("/")), resolvePath("~", toHome("/"))]).toStrictEqual(["/x", "/"])
  })

  it.each([
    ["~bob/x", "~bob/x"],
    ["app.conf", "app.conf"],
  ])("should leave '%s' relative", (writtenPath, resolvedPath) => {
    expect(resolvePath(writtenPath, HOME)).toBe(resolvedPath)
  })

  it("should resolve a '..' segment as text", () => {
    expect(resolvePath("/etc/x/../app.conf", HOME)).toBe("/etc/app.conf")
  })
})
