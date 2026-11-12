import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { castInvalid, createSession, getFailureMessage } from "#__tests__/session.ts"
import type { Host, ReadOptions } from "#session/session.ts"

const SECRET = "s3cret-value"

// Build the secret from two parts, so a command's own text doesn't hold it.
const PRINT_SECRET = "printf '%s-%s' s3cret value"

/** Reads `cmd` with `options`, and returns its output, or the thrown error's message chain. */
const readOrMessage = async (h: Host, cmd: string, options: ReadOptions) => {
  const output = await attempt(async () => h.read(cmd, options))
  return isErr(output) ? messageChain(output) : output
}

/** Returns each finished step's name, shell options, and the stdout each of its commands recorded. */
const getRecordedSteps = (hostSession: Awaited<ReturnType<typeof createSession>>) =>
  hostSession.hostRecord.stepRecords.map(({ name, shellOptions, commands }) => ({
    name,
    shellOptions,
    stdouts: commands.map(({ output }) => (output === undefined || isErr(output) ? undefined : output.stdout)),
  }))

describe("env and secretEnv", () => {
  it("should give h.read's command its variables, each value as it is", async () => {
    const { host: h } = await createSession()
    const value = `a $HOME "b" 'c'`

    expect(await h.read('printf "%s|%s" "$V" "$T"', { env: { V: value }, secretEnv: { T: "t" } })).toBe(`${value}|t`)
  })

  it("should record h.read's shell options with each secret masked, and mask the secret in its output", async () => {
    const hostSession = await createSession()
    const stdout = await hostSession.host.read('printf %s "$TOKEN"', {
      env: { URL: "u" },
      secretEnv: { TOKEN: SECRET },
    })

    expect({
      stdout,
      steps: getRecordedSteps(hostSession),
      hasSecret: JSON.stringify(hostSession.hostRecord).includes(SECRET),
    }).toStrictEqual({
      stdout: SECRET,
      steps: [
        {
          name: 'printf %s "$TOKEN"',
          shellOptions: { sudo: false, env: { URL: "u" }, secretEnv: { TOKEN: "[MASKED]" } },
          stdouts: ["[MASKED]"],
        },
      ],
      hasSecret: false,
    })
  })

  it("should give an ensure's check, fix, and check function's tools its variables", async () => {
    const { host: h } = await createSession("apply")
    const filePath = path.join(await makeTempDir(), "token")
    const stepEnv = { env: { FILE: filePath }, secretEnv: { TOKEN: SECRET } }

    const written = await h.ensure("Write the token", {
      check: 'grep -qxF "$TOKEN" "$FILE"',
      want: true,
      fix: String.raw`printf "%s\n" "$TOKEN" > "$FILE"`,
      ...stepEnv,
    })
    const read = await h.ensure("Read the token", {
      check: async ({ read: readTool }) => readTool('cat "$FILE"'),
      want: SECRET,
      fix: "false",
      ...stepEnv,
    })

    expect([written.changed, read.changed, await Bun.file(filePath).text()]).toStrictEqual([true, false, `${SECRET}\n`])
  })

  it("should give a run's command and its function's exec its variables", async () => {
    const { host: h } = await createSession("apply")
    const filePath = path.join(await makeTempDir(), "out")
    const env = { FILE: filePath, V: "v" }

    await h.run("Write V", 'printf %s "$V" > "$FILE"', { after: "always", env })
    await h.run(
      "Append V",
      async ({ exec }) => {
        await exec('printf %s "$V" >> "$FILE"')
      },
      { after: "always", env },
    )

    expect(await Bun.file(filePath).text()).toBe("vv")
  })

  it("should set PATH to exactly the text given, without expanding it", async () => {
    const { host: h } = await createSession()

    expect(await h.read('printf %s "$PATH"', { env: { PATH: "/opt/bin:$PATH" } })).toBe("/opt/bin:$PATH")
  })

  it("should fail the step for a name that isn't a valid shell name", async () => {
    const hostSession = await createSession()

    expect(await readOrMessage(hostSession.host, "true", { env: { "MY-TOKEN": "x", "1A": "y" } })).toBe(
      "failed to validate the options given to 'read' -> env must be valid shell names, of letters, digits, and underscores, not starting with a digit (was 'MY-TOKEN', '1A')",
    )
    expect(hostSession.hostRecord.failure?.kind).toBe("step")
  })

  it("should fail the step for a value that isn't a string", async () => {
    const { host: h } = await createSession()

    expect(await readOrMessage(h, "true", { secretEnv: { PORT: castInvalid(8080) } })).toBe(
      "failed to validate the options given to 'read' -> secretEnv.PORT must be a string (was a number)",
    )
  })

  it("should fail the step for a name in both env and secretEnv", async () => {
    const { host: h } = await createSession()

    expect(await readOrMessage(h, "true", { env: { TOKEN: "a" }, secretEnv: { TOKEN: "b" } })).toBe(
      "failed to validate the options given to 'read' -> must be names in only one of env and secretEnv (was 'TOKEN')",
    )
  })
})

describe("maskOutput", () => {
  it("should mask h.read's output in the record, and the value in a later step, and still return it", async () => {
    const hostSession = await createSession()
    const stdout = await hostSession.host.read(PRINT_SECRET, { maskOutput: true })
    await hostSession.host.read(`echo ${SECRET}`)

    expect({ stdout, steps: getRecordedSteps(hostSession) }).toStrictEqual({
      stdout: SECRET,
      steps: [
        { name: PRINT_SECRET, shellOptions: { sudo: false, env: {}, secretEnv: {} }, stdouts: ["[MASKED]"] },
        { name: "echo [MASKED]", shellOptions: { sudo: false, env: {}, secretEnv: {} }, stdouts: ["[MASKED]\n"] },
      ],
    })
  })

  it("should mask h.inspect's stdout in the record, and still return it", async () => {
    const hostSession = await createSession()
    const { stdout } = await hostSession.host.inspect(PRINT_SECRET, { maskOutput: true })

    expect({ stdout, stdouts: getRecordedSteps(hostSession).map(({ stdouts }) => stdouts) }).toStrictEqual({
      stdout: SECRET,
      stdouts: [["[MASKED]"]],
    })
  })

  it("should mask a tool's output in the record", async () => {
    const hostSession = await createSession("plan")
    await hostSession.host.ensure("Have a secret", {
      check: async ({ read }) => (await read(PRINT_SECRET, { maskOutput: true })) === SECRET,
      want: true,
      fix: "false",
    })

    expect(getRecordedSteps(hostSession).map(({ stdouts }) => stdouts)).toStrictEqual([["[MASKED]"]])
  })

  it("should fail h.read for a maskOutput that isn't a boolean", async () => {
    const { host: h } = await createSession()

    expect(await readOrMessage(h, "true", { maskOutput: castInvalid("yes") })).toBe(
      `failed to validate the options given to 'read' -> maskOutput must be boolean (was "yes")`,
    )
  })

  it("should fail a tool for a maskOutput that isn't a boolean", async () => {
    const hostSession = await createSession("plan")
    await attempt(async () =>
      hostSession.host.ensure("Have a secret", {
        check: async ({ read }) => read("true", { maskOutput: castInvalid("yes") }),
        want: "",
        fix: "false",
      }),
    )

    expect(getFailureMessage(hostSession)).toBe(
      `failed to compare the host with what the step wants -> failed to validate the options given to 'read' -> maskOutput must be boolean (was "yes")`,
    )
  })
})
