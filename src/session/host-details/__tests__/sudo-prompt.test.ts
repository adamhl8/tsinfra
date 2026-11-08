import { describe, expect, it } from "bun:test"
import path from "node:path"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import { $ } from "bun"

import { writeFakeTool } from "#__tests__/session.ts"
import { answerPrompts } from "#__tests__/terminal.ts"

const FIXTURE = path.join(import.meta.dir, "fixtures", "prompt-hosts.ts")
const PROMPT_MARKER = "enter the sudo password for"

// Stand in for `sudo` with a tool that fails `-n`, and with `-S` accepts only the password `right`.
const FAKE_SUDO = [
  "if [ \"$1\" = -n ]; then echo 'sudo: a password is required' >&2; exit 1; fi",
  "read -r password",
  '[ "$password" = right ] && exit 0',
  "echo 'sudo: 1 incorrect password attempt' >&2",
  "exit 1",
].join("\n")

const USER = (await $`id -un`.text()).trim()

const buildPrompt = (name: string) =>
  `To run host '${name}', enter the sudo password for '${USER}' (press Ctrl-D to skip this host, or Ctrl-C to cancel the entire run): `

/**
 * Prepares a `sudo: true` host for each of `names` in a terminal, with the fake `sudo` first on `PATH` and a temp
 * `HOME` for the askpass helper, and types `answers` at the prompts. Returns everything the terminal showed.
 */
const prepareInTerminal = async (names: string[], answers: string[], cmd = [process.execPath, FIXTURE, ...names]) => {
  const home = await makeTempDir()
  const binDir = await makeTempDir()
  await writeFakeTool(binDir, "sudo", FAKE_SUDO)
  const env = { ...process.env, HOME: home, PATH: `${binDir}:${process.env["PATH"]}` }

  const { screen } = await answerPrompts(cmd, PROMPT_MARKER, answers, env)
  return screen
}

/** Returns the line the fixture prints for `results`, as the terminal shows it. */
const resultsLine = (results: string[][]) => `${JSON.stringify(results)}\r\n`

describe("prepareHosts with a sudo: true host whose sudo needs a password", () => {
  it("should prompt for the password, and prepare the host with the right one", async () => {
    expect(await prepareInTerminal(["a"], ["right\r"])).toBe(
      `${buildPrompt("a")}\r\n${resultsLine([["a", "prepared"]])}`,
    )
  })

  it("should prompt again after a wrong password", async () => {
    expect(await prepareInTerminal(["a"], ["wrong\r", "right\r"])).toBe(
      `${buildPrompt("a")}\r\nSorry, try again.\r\n${buildPrompt("a")}\r\n${resultsLine([["a", "prepared"]])}`,
    )
  })

  it("should fail the host after three wrong passwords", async () => {
    const prompt = buildPrompt("a")

    expect(await prepareInTerminal(["a"], ["wrong\r", "wrong\r", "wrong\r"])).toBe(
      `${prompt}\r\nSorry, try again.\r\n${prompt}\r\nSorry, try again.\r\n${prompt}\r\n${resultsLine([
        ["a", "incorrect sudo password -> exited with code 1: sudo: 1 incorrect password attempt"],
      ])}`,
    )
  })

  it("should skip the host with Ctrl-D", async () => {
    expect(await prepareInTerminal(["a"], ["\u0004"])).toBe(
      `${buildPrompt("a")}\r\n${resultsLine([["a", "skipped sudo password prompt"]])}`,
    )
  })

  it("should prompt one host at a time, in the hosts' order", async () => {
    expect(await prepareInTerminal(["a", "b"], ["right\r", "right\r"])).toBe(
      `${buildPrompt("a")}\r\n${buildPrompt("b")}\r\n${resultsLine([
        ["a", "prepared"],
        ["b", "prepared"],
      ])}`,
    )
  })

  it("should fail the host without prompting when stderr isn't a terminal", async () => {
    const cmd = ["sh", "-c", `exec '${process.execPath}' '${FIXTURE}' a 2>/dev/null`]

    expect(await prepareInTerminal(["a"], [], cmd)).toBe(
      resultsLine([
        [
          "a",
          "needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host() -> exited with code 1: sudo: a password is required",
        ],
      ]),
    )
  })
})
