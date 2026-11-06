import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { resolveHome } from "#session/handlers/shared/path.ts"

const toMessage = (...resolveHomeArgs: Parameters<typeof resolveHome>) => {
  const resolved = resolveHome(...resolveHomeArgs)
  return isErr(resolved) ? messageChain(resolved) : resolved
}

describe("resolveHome", () => {
  it("should replace a leading ~/ and a bare ~ with the home directory", () => {
    expect([toMessage("~/.config/fish", "/home/adam"), toMessage("~", "/home/adam")]).toStrictEqual([
      "/home/adam/.config/fish",
      "/home/adam",
    ])
  })

  it("should leave an absolute path as it is, whatever the home directory", () => {
    expect(toMessage("/etc/app.conf", "")).toBe("/etc/app.conf")
  })

  it("should fail when $HOME is empty", () => {
    expect(toMessage("~/x", "")).toBe("can't resolve ~/ in '~/x', because $HOME isn't set on the host")
  })

  it("should fail when $HOME isn't absolute", () => {
    expect(toMessage("~/x", "adam")).toBe(
      "can't resolve ~/ in '~/x', because $HOME on the host is 'adam', not an absolute path",
    )
  })
})
