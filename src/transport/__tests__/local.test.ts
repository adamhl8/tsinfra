import { describe, expect, it } from "bun:test"
import os from "node:os"

import { runLocal } from "#transport/local.ts"

describe("runLocal", () => {
  it("should return stdout, stderr, and the exit code", async () => {
    expect(await runLocal("echo out; echo err >&2; exit 3")).toStrictEqual({
      stdout: "out\n",
      stderr: "err\n",
      exitCode: 3,
    })
  })

  it("should give commands /dev/null as stdin instead of the rest of the script", async () => {
    expect(await runLocal("cat\necho after")).toStrictEqual({ stdout: "after\n", stderr: "", exitCode: 0 })
  })

  it("should run a script that ends in a comment", async () => {
    expect(await runLocal("echo hi # done")).toStrictEqual({ stdout: "hi\n", stderr: "", exitCode: 0 })
  })

  it("should pass the script to sh without any other quoting", async () => {
    expect(await runLocal(String.raw`printf '%s' 'a "b" $c \d'`)).toStrictEqual({
      stdout: String.raw`a "b" $c \d`,
      stderr: "",
      exitCode: 0,
    })
  })

  it("should run from the home directory", async () => {
    expect(await runLocal("pwd")).toStrictEqual({ stdout: `${os.homedir()}\n`, stderr: "", exitCode: 0 })
  })
})
