import { describe, expect, it } from "bun:test"
import path from "node:path"
import process from "node:process"

import { makeTempDir } from "@adamhl8/configs/test"
import { $ } from "bun"

import { writeFakeTool } from "#__tests__/session.ts"
import { answerPrompts } from "#__tests__/terminal.ts"

const FIXTURE = path.join(import.meta.dir, "fixtures", "prompt-hosts.ts")
const PASSWORD_PROMPT = "Password: "

// Stand in for `sudo` with a tool that fails `-n`, and with `-S` accepts only the password `right`.
// Print the line sudo ends a wrong password with, because that's how a wrong password is told apart.
const FAKE_SUDO = [
  "if [ \"$1\" = -n ]; then echo 'sudo: a password is required' >&2; exit 1; fi",
  "read -r password",
  '[ "$password" = right ] && exit 0',
  "echo 'sudo: 1 incorrect password attempt' >&2",
  "exit 1",
].join("\n")

const USER = (await $`id -un`.text()).trim()

/** Returns the two lines a host's prompt starts with, as the terminal shows them. */
const buildPromptHeader = (name: string) =>
  `Ctrl-D to skip this host · Ctrl-C to cancel the entire run\r\nTo run host '${name}', enter the sudo password for user '${USER}'.\r\n`

/**
 * Prepares a `sudo: true` host for each of `names` in a terminal, with the fake `sudo` first on `PATH` and a temp
 * `HOME` for the askpass helper, and types `answers` at the prompts. Returns everything the terminal showed.
 */
const prepareInTerminal = async (
  names: string[],
  answers: string[],
  { cmd = [process.execPath, FIXTURE, ...names], prompt = PASSWORD_PROMPT, sudoBody = FAKE_SUDO } = {},
) => {
  const home = await makeTempDir()
  const binDir = await makeTempDir()
  await writeFakeTool(binDir, "sudo", sudoBody)
  const env = { ...process.env, HOME: home, PATH: `${binDir}:${process.env["PATH"]}`, NO_COLOR: "1" }

  const { screen } = await answerPrompts(cmd, prompt, answers, env)
  return screen
}

/** Returns the line the fixture prints for `results`, as the terminal shows it. */
const resultsLine = (results: string[][]) => `${JSON.stringify(results)}\r\n`

// Expect `\r\n` for every newline, because the terminal turns each `\n` the program writes into `\r\n`.
// Show each try as the prompt, then the newline the reader prints once the line is in.
const PASSWORD_TRY = `${PASSWORD_PROMPT}\r\n`
const SORRY = "Sorry, try again.\r\n"
const INCORRECT_SKIPPING_HOST = "incorrect sudo password, skipping host\r\n\r\n"
const SKIPPING_HOST = "skipping host\r\n\r\n"
// Expect the blank line a right password leaves before the next host's prompt.
const ACCEPTED = "\r\n"

describe("prepareHosts with a sudo: true host whose sudo needs a password", () => {
  it("should prompt for the password, and prepare the host with the right one", async () => {
    expect(await prepareInTerminal(["a"], ["right\r"])).toBe(
      `${buildPromptHeader("a")}${PASSWORD_TRY}${ACCEPTED}${resultsLine([["a", "prepared"]])}`,
    )
  })

  it("should ask again with only the password line after a wrong password", async () => {
    expect(await prepareInTerminal(["a"], ["wrong\r", "right\r"])).toBe(
      `${buildPromptHeader("a")}${PASSWORD_TRY}${SORRY}${PASSWORD_TRY}${ACCEPTED}${resultsLine([["a", "prepared"]])}`,
    )
  })

  it("should fail the host after three wrong passwords, and say so before the next host", async () => {
    expect(await prepareInTerminal(["a"], ["wrong\r", "wrong\r", "wrong\r"])).toBe(
      [
        buildPromptHeader("a"),
        PASSWORD_TRY,
        SORRY,
        PASSWORD_TRY,
        SORRY,
        PASSWORD_TRY,
        INCORRECT_SKIPPING_HOST,
        resultsLine([["a", "incorrect sudo password"]]),
      ].join(""),
    )
  })

  it("should skip the host with Ctrl-D, and say so before the next host", async () => {
    expect(await prepareInTerminal(["a"], ["\u0004"])).toBe(
      `${buildPromptHeader("a")}${PASSWORD_TRY}${SKIPPING_HOST}${resultsLine([["a", "skipped sudo password prompt"]])}`,
    )
  })

  it("should stop at once when sudo fails for a reason other than the password", async () => {
    const notInSudoers = [
      "if [ \"$1\" = -n ]; then echo 'sudo: a password is required' >&2; exit 1; fi",
      "echo 'adam is not in the sudoers file.' >&2",
      "exit 1",
    ].join("\n")

    expect(await prepareInTerminal(["a"], ["right\r"], { sudoBody: notInSudoers })).toBe(
      [
        buildPromptHeader("a"),
        PASSWORD_TRY,
        "failed to check the sudo password, skipping host\r\n\r\n",
        resultsLine([
          ["a", "failed to check the sudo password -> exited with code 1: adam is not in the sudoers file."],
        ]),
      ].join(""),
    )
  })

  it("should not show a password typed as soon as the host line shows", async () => {
    expect(await prepareInTerminal(["a"], ["right\r"], { prompt: "enter the sudo password for user" })).toBe(
      `${buildPromptHeader("a")}${PASSWORD_TRY}${ACCEPTED}${resultsLine([["a", "prepared"]])}`,
    )
  })

  it("should prompt one host at a time, in the hosts' order", async () => {
    expect(await prepareInTerminal(["a", "b"], ["right\r", "right\r"])).toBe(
      `${buildPromptHeader("a")}${PASSWORD_TRY}${ACCEPTED}${buildPromptHeader("b")}${PASSWORD_TRY}${ACCEPTED}${resultsLine(
        [
          ["a", "prepared"],
          ["b", "prepared"],
        ],
      )}`,
    )
  })

  it("should fail the host without prompting when stderr isn't a terminal", async () => {
    const cmd = ["sh", "-c", `exec '${process.execPath}' '${FIXTURE}' a 2>/dev/null`]

    expect(await prepareInTerminal(["a"], [], { cmd })).toBe(
      resultsLine([
        [
          "a",
          "needs a sudo password: set up passwordless sudo, or pass sudo: { password } to host() -> exited with code 1: sudo: a password is required",
        ],
      ]),
    )
  })
})
