import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { validateHome } from "#core/hosts/prepare/host-details/facts/home.ts"

/** Returns the home `validateHome` accepts, or why it refused it. */
const toHomeOrMessage = (rawHome: string) => {
  const home = validateHome(rawHome)
  return isErr(home) ? messageChain(home) : home
}

describe("validateHome", () => {
  it("should accept an absolute home directory, including /", () => {
    expect([toHomeOrMessage("/home/alice"), toHomeOrMessage("/")]).toStrictEqual(["/home/alice", "/"])
  })

  it("should fail when $HOME is empty", () => {
    expect(toHomeOrMessage("")).toBe("$HOME isn't set on the host")
  })

  it("should fail when $HOME isn't absolute", () => {
    expect(toHomeOrMessage("alice")).toBe("$HOME on the host is 'alice', not an absolute path")
  })
})
