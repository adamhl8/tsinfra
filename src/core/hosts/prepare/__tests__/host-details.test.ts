import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { validateHome } from "#core/hosts/prepare/host-details.ts"

const toMessage = (rawHome: string) => {
  const home = validateHome(rawHome)
  return isErr(home) ? messageChain(home) : home
}

describe("validateHome", () => {
  it("should accept an absolute home directory, including /", () => {
    expect([toMessage("/home/adam"), toMessage("/")]).toStrictEqual(["/home/adam", "/"])
  })

  it("should fail when $HOME is empty", () => {
    expect(toMessage("")).toBe("$HOME isn't set on the host")
  })

  it("should fail when $HOME isn't absolute", () => {
    expect(toMessage("adam")).toBe("$HOME on the host is 'adam', not an absolute path")
  })
})
