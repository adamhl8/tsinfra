import { describe, expectTypeOf, it } from "bun:test"

import { host } from "#core/hosts/host.ts"
import type { Host } from "#core/session.ts"

const configure = async (h: Host) => {
  await h.read("true")
}

// Never call these host functions, because only `tsc` checks what they hold.
// Give each one an `await` anyway, because a `HostFunction` returns a promise.
describe("host", () => {
  it("should type h.meta.sudoPassword as a string when the host passes sudo: { password }", () => {
    host({ name: "a", target: "@local", sudo: { password: "a" } }, async (h) => {
      expectTypeOf(h.meta.sudoPassword).toEqualTypeOf<string>()
      await h.read("true")
    })
  })

  it("should type h.meta.sudoPassword as maybe undefined with sudo: true, because passwordless sudo gives none", () => {
    host({ name: "a", target: "@local", sudo: true }, async (h) => {
      expectTypeOf(h.meta.sudoPassword).toEqualTypeOf<string | undefined>()
      await h.read("true")
    })
  })

  it("should type h.meta.sudoPassword as undefined when the host leaves sudo off", () => {
    host({ name: "a", target: "@local" }, async (h) => {
      expectTypeOf(h.meta.sudoPassword).toEqualTypeOf<undefined>()
      await h.read("true")
    })
    host({ name: "a", target: "@local", sudo: false }, async (h) => {
      expectTypeOf(h.meta.sudoPassword).toEqualTypeOf<undefined>()
      await h.read("true")
    })
  })

  it("should let an integration that takes the plain Host take any host's h", () => {
    expectTypeOf<Host<{ sudo: { password: string } }>>().toExtend<Host>()
    expectTypeOf<Host<{ sudo: true }>>().toExtend<Host>()
    expectTypeOf<Host<{ sudo: false }>>().toExtend<Host>()
  })

  it("should take a host function written for the plain Host", () => {
    host({ name: "a", target: "@local", sudo: { password: "a" } }, configure)
  })
})
