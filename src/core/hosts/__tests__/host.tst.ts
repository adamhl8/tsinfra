import { describe, expect, it } from "tstyche"

import { host } from "#core/hosts/host.ts"
import type { Host } from "#core/session.ts"

const configure = async (h: Host) => {
  await h.read("true")
}

// Give each host function an `await`, because a `HostFunction` returns a promise.
describe("host", () => {
  it("should type h.meta.sudoPassword as a string when the host passes sudo: { password }", () => {
    host({ name: "a", target: "@local", sudo: { password: "a" } }, async (h) => {
      expect(h.meta.sudoPassword).type.toBe<string>()
      await h.read("true")
    })
  })

  it("should type h.meta.sudoPassword as maybe undefined with sudo: true, because passwordless sudo gives none", () => {
    host({ name: "a", target: "@local", sudo: true }, async (h) => {
      expect(h.meta.sudoPassword).type.toBe<string | undefined>()
      await h.read("true")
    })
  })

  it("should type h.meta.sudoPassword as undefined when the host leaves sudo off", () => {
    host({ name: "a", target: "@local" }, async (h) => {
      expect(h.meta.sudoPassword).type.toBe<undefined>()
      await h.read("true")
    })
    host({ name: "a", target: "@local", sudo: false }, async (h) => {
      expect(h.meta.sudoPassword).type.toBe<undefined>()
      await h.read("true")
    })
  })

  it("should let an integration that takes the plain Host take any host's h", () => {
    expect<Host<{ sudo: { password: string } }>>().type.toBeAssignableTo<Host>()
    expect<Host<{ sudo: true }>>().type.toBeAssignableTo<Host>()
    expect<Host<{ sudo: false }>>().type.toBeAssignableTo<Host>()
  })

  it("should take a host function written for the plain Host", () => {
    expect(host).type.toBeCallableWith({ name: "a", target: "@local", sudo: { password: "a" } }, configure)
  })
})
