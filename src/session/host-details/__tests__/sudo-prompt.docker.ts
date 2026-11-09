import { describe, expect, it } from "bun:test"
import path from "node:path"
import process from "node:process"

import { $ } from "bun"

import { answerPrompts } from "#__tests__/terminal.ts"

// `setup.sh` gives this user this password.
const PASSWORD = "it's tsinfra"
const PROMPT_HEADER =
  "Ctrl-D to skip this host · Ctrl-C to cancel the entire run\r\nTo run host 'prompted', enter the sudo password for user 'sudopw'.\r\n"
const PASSWORD_PROMPT = "Password: "

// Run the CLI from source, because this user can't write the `dist/` that packing would build.
const CLI = path.resolve(import.meta.dir, "../../../cli/cli.ts")
const HOSTS_DIR = path.join(import.meta.dir, "fixtures", "sudo-prompt-hosts")

// Give three wrong passwords time to fail, because sudo waits after each one.
const WRONG_PASSWORDS_TIMEOUT_MS = 30_000

/** Runs `tsinfra apply` in a terminal, and types `answers` at the sudo password prompts. */
const applyInTerminal = async (answers: string[]) =>
  answerPrompts([process.execPath, CLI, "apply", "--hosts-dir", HOSTS_DIR], PASSWORD_PROMPT, answers, {
    ...process.env,
    NO_COLOR: "1",
  })

describe("a user whose sudo needs a password, typed at the prompt", () => {
  it("should write a root-only file with the password typed at the prompt", async () => {
    const { screen, exitCode } = await applyInTerminal([`${PASSWORD}\r`])

    expect(screen).toStartWith(`${PROMPT_HEADER}${PASSWORD_PROMPT}\r\n`)
    expect(screen).not.toContain(PASSWORD)
    expect(exitCode).toBe(0)
    expect((await $`stat -c %U /etc/tsinfra-docker-prompt.conf`.text()).trim()).toBe("root")
  })

  it(
    "should fail the host after three wrong passwords",
    async () => {
      const { screen, exitCode } = await applyInTerminal(["wrong\r", "wrong\r", "wrong\r"])

      expect(screen).toContain("incorrect sudo password")
      expect(exitCode).toBe(1)
    },
    WRONG_PASSWORDS_TIMEOUT_MS,
  )
})
