import { describe, expect, it } from "bun:test"
import os from "node:os"
import path from "node:path"
import process from "node:process"

import { answerPrompts } from "#__tests__/terminal.ts"
import { runLocal } from "#core/transport/local.ts"

const OPEN_TTY_FIXTURE = path.join(import.meta.dir, "fixtures", "open-tty.ts")

describe("runLocal", () => {
  it("should return stdout, stderr, and the exit code", async () => {
    expect(await runLocal("echo out; echo err >&2; exit 3")).toStrictEqual({
      stdout: "out\n",
      stderr: "err\n",
      exitCode: 3,
    })
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

  it("should start a command with no terminal, even when tsinfra runs in one", async () => {
    const { screen } = await answerPrompts([process.execPath, OPEN_TTY_FIXTURE], "", [])

    expect(screen).toBe("no terminal\r\n")
  })
})
