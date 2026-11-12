import { describe, expect, it } from "bun:test"

import type { ValidStepShellOptions } from "#session/session.ts"
import { runLocal } from "#transport/local.ts"
import { createStepTransport } from "#transport/step.ts"

const NO_OPTIONS: ValidStepShellOptions = { sudo: false, env: {}, secretEnv: {} }

// Hold every character a value could break on in a script: a variable, both quotes, a space, and a newline.
const AWKWARD_VALUE = `a $HOME "b" 'c'\nd`

/**
 * Runs `cmd` on a step transport built from `options`, and returns its output and every script it sent. Stand in for
 * `sudo` with a function that prints its arguments, then runs them with an empty environment, as sudo resets it.
 */
const runInStep = async (options: ValidStepShellOptions, cmd: string) => {
  const scripts: string[] = []
  const stepTransport = createStepTransport(async (script) => {
    scripts.push(script)
    return runLocal(`sudo() { echo "sudo $*"; env -i PATH="$PATH" "$@"; }\n${script}`)
  }, options)

  return { output: await stepTransport(cmd), scripts }
}

describe("createStepTransport", () => {
  it("should send a command with no options unchanged", async () => {
    expect(await runInStep(NO_OPTIONS, "echo hi")).toStrictEqual({
      output: { stdout: "hi\n", stderr: "", exitCode: 0 },
      scripts: ["echo hi"],
    })
  })

  it("should export a step's variables, with any value unchanged", async () => {
    const options = { ...NO_OPTIONS, env: { V: AWKWARD_VALUE }, secretEnv: { TOKEN: "t" } }
    const { output } = await runInStep(options, `sh -c 'printf "%s|%s" "$V" "$TOKEN"'`)

    expect(output).toStrictEqual({ stdout: `${AWKWARD_VALUE}|t`, stderr: "", exitCode: 0 })
  })

  it("should set the variables inside the root shell for sudo: true", async () => {
    const { output } = await runInStep({ ...NO_OPTIONS, sudo: true, env: { V: AWKWARD_VALUE } }, 'printf %s "$V"')

    expect(output).toStrictEqual({ stdout: `sudo sh -s\n${AWKWARD_VALUE}`, stderr: "", exitCode: 0 })
  })

  it("should keep a sudo: true command from reading the rest of the script as its stdin", async () => {
    const { output } = await runInStep({ ...NO_OPTIONS, sudo: true }, "cat\necho after")

    expect(output).toStrictEqual({ stdout: "sudo sh -s\nafter\n", stderr: "", exitCode: 0 })
  })

  it("should give the exit code of a sudo: true script", async () => {
    const { output } = await runInStep({ ...NO_OPTIONS, sudo: true }, "set -eu\nfalse\necho not-reached")

    expect(output).toStrictEqual({ stdout: "sudo sh -s\n", stderr: "", exitCode: 1 })
  })
})
