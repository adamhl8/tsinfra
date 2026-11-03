import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { toAbsolutePath } from "#session/steps/file/path.ts"

const toMessage = (path: string, home: string) => {
  const resolved = toAbsolutePath(path, home)
  return isErr(resolved) ? messageChain(resolved) : resolved
}

describe("toAbsolutePath", () => {
  it("should replace a leading ~/ and a bare ~ with the home directory", () => {
    expect([toMessage("~/.config/fish", "/home/adam"), toMessage("~", "/home/adam")]).toStrictEqual([
      "/home/adam/.config/fish",
      "/home/adam",
    ])
  })

  it("should leave an absolute path as it is, whatever the home directory", () => {
    expect(toMessage("/etc/app.conf", "")).toBe("/etc/app.conf")
  })

  it("should fail for a relative path", () => {
    expect(toMessage("etc/app.conf", "/home/adam")).toBe(
      "'etc/app.conf' isn't an absolute path, so start it with / or ~/",
    )
  })

  it("should fail when $HOME is empty", () => {
    expect(toMessage("~/x", "")).toBe("can't resolve ~/ in '~/x', because $HOME isn't set on the host")
  })

  it("should fail when $HOME isn't absolute", () => {
    expect(toMessage("~/x", "adam")).toBe(
      "can't resolve ~/ in '~/x', because $HOME on the host is 'adam', not an absolute path",
    )
  })

  it("should fail for another user's home", () => {
    expect(toMessage("~bob/x", "/home/adam")).toBe("'~bob/x' isn't an absolute path, so start it with / or ~/")
  })
})
