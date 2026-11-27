import { describe, expect, it } from "bun:test"

import { isErr, messageChain } from "ts-explicit-errors"

import { toOsRelease } from "#core/hosts/prepare/host-details/facts/os-release.ts"

/** Returns what the os-release command prints for `values`, each `NAME=value` on a line of its own. */
const toOutput = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([name, value]) => `${name}=${value}\n`)
    .join("")

/** Returns the distribution `toOsRelease` read from `output`, or why it refused it. */
const toOsReleaseOrMessage = (output: string) => {
  const osRelease = toOsRelease(output)
  return isErr(osRelease) ? messageChain(osRelease) : osRelease
}

describe("toOsRelease", () => {
  it("should have no distribution when the command printed nothing", () => {
    expect(toOsReleaseOrMessage("")).toBeUndefined()
  })

  it("should read each value, with an empty one left out and an `=` inside one kept", () => {
    const output = toOutput({
      ID: "ubuntu",
      ID_LIKE: "debian  linux",
      VERSION_ID: "",
      VERSION_CODENAME: "noble",
      PRETTY_NAME: "a=b",
    })

    expect(toOsReleaseOrMessage(output)).toStrictEqual({
      id: "ubuntu",
      idLike: ["debian", "linux"],
      versionId: undefined,
      versionCodename: "noble",
      prettyName: "a=b",
    })
  })

  it("should default an empty ID to linux, as the os-release spec does", () => {
    const output = toOutput({ ID: "", ID_LIKE: "", VERSION_ID: "", VERSION_CODENAME: "", PRETTY_NAME: "" })

    expect(toOsReleaseOrMessage(output)).toMatchObject({ id: "linux", idLike: [] })
  })

  it("should fail when a name the command always prints is missing", () => {
    expect(toOsReleaseOrMessage("ID=debian\n")).toStartWith(
      "the os-release command printed values tsinfra can't read -> ",
    )
  })
})
