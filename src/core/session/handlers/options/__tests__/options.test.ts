import { describe, expect, it } from "bun:test"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { castInvalid, createSession, getFailureMessage, getFinishedStepRecords } from "#core/__tests__/session.ts"
import type { Host } from "#core/session.ts"
import type { ReadOptions } from "#core/session/handlers/read.ts"

const SECRET = "s3cret-value"

// Build the secret from two parts, so a command's own text doesn't hold it.
const PRINT_SECRET = "printf '%s-%s' s3cret value"

/** Reads `cmd` with `options`, and returns its output, or the thrown error's message chain. */
const readOrMessage = async (h: Host, cmd: string, options: ReadOptions) => {
  const output = await attempt(async () => h.read(cmd, options))
  return isErr(output) ? messageChain(output) : output
}

/** Returns each finished step's name, options, and the stdout each of its commands recorded. */
const getRecordedSteps = (hostSession: Awaited<ReturnType<typeof createSession>>) =>
  getFinishedStepRecords(hostSession.hostRecord).map(({ name, options, commands }) => ({
    name,
    options,
    stdouts: commands.map(({ output }) => (output === undefined || isErr(output) ? undefined : output.stdout)),
  }))

/** Returns the tool call each finished step's commands recorded, keyed by each command. */
const getRecordedToolCalls = (hostSession: Awaited<ReturnType<typeof createSession>>) =>
  getFinishedStepRecords(hostSession.hostRecord).map(({ commands }) =>
    Object.fromEntries(commands.map(({ cmd, toolCall }) => [cmd, toolCall])),
  )

describe("env and secretEnv", () => {
  it("should give h.read's command its variables, each value as it is", async () => {
    const { host: h } = await createSession()
    const value = `a $HOME "b" 'c'`

    expect(await h.read('printf "%s|%s" "$V" "$T"', { env: { V: value }, secretEnv: { T: "t" } })).toBe(`${value}|t`)
  })

  it("should record h.read's options with each secret masked, and mask the secret in its output", async () => {
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
          options: { env: { URL: "u" }, secretEnv: { TOKEN: "[MASKED]" } },
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
      want: true,
      check: 'grep -qxF "$TOKEN" "$FILE"',
      fix: String.raw`printf "%s\n" "$TOKEN" > "$FILE"`,
      ...stepEnv,
    })
    const read = await h.ensure("Read the token", {
      want: SECRET,
      check: async ({ read: readTool }) => readTool('cat "$FILE"'),
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

  it("should give a tool call's env over the step's secretEnv for that call only, and keep the step's secret masked", async () => {
    const hostSession = await createSession("apply")
    const outputs: string[] = []
    await hostSession.host.run(
      "Print the token",
      async ({ exec }) => {
        outputs.push(await exec('printf %s "$TOKEN"', { env: { TOKEN: "plain" } }), await exec('printf "%s" "$TOKEN"'))
      },
      { after: "always", secretEnv: { TOKEN: SECRET } },
    )

    expect({
      outputs,
      stdouts: getRecordedSteps(hostSession).map(({ stdouts }) => stdouts),
      hasSecret: JSON.stringify(hostSession.hostRecord).includes(SECRET),
    }).toStrictEqual({ outputs: ["plain", SECRET], stdouts: [["plain", "[MASKED]"]], hasSecret: false })
  })

  it("should mask a tool call's secret in its record, and in a later step", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run(
      "Print the token",
      async ({ exec }) => {
        await exec('printf %s "$TOKEN"', { secretEnv: { TOKEN: SECRET } })
      },
      { after: "always" },
    )
    await hostSession.host.read(PRINT_SECRET)

    expect({
      stdouts: getRecordedSteps(hostSession).map(({ stdouts }) => stdouts),
      toolCalls: getRecordedToolCalls(hostSession),
      hasSecret: JSON.stringify(hostSession.hostRecord).includes(SECRET),
    }).toStrictEqual({
      stdouts: [["[MASKED]"], ["[MASKED]"]],
      toolCalls: [
        { 'printf %s "$TOKEN"': { toolName: "exec", options: { secretEnv: { TOKEN: "[MASKED]" } } } },
        { [PRINT_SECRET]: undefined },
      ],
      hasSecret: false,
    })
  })

  it("should set PATH to exactly the text given, without expanding it", async () => {
    const { host: h } = await createSession()

    expect(await h.read('printf %s "$PATH"', { env: { PATH: "/opt/bin:$PATH" } })).toBe("/opt/bin:$PATH")
  })

  it("should fail the step for a name that isn't a valid shell name", async () => {
    const hostSession = await createSession()

    expect(await readOrMessage(hostSession.host, "true", { env: { "MY-TOKEN": "x", "1A": "y" } })).toBe(
      "failed to validate the options given to 'read' -> env must be valid variable names, of letters, digits, and underscores, not starting with a digit (was 'MY-TOKEN', '1A')",
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

  it("should fail a tool for a name in both env and secretEnv", async () => {
    const hostSession = await createSession("plan")
    await attempt(async () =>
      hostSession.host.ensure("Have a token", {
        want: "",
        check: async ({ read }) => read("true", { env: { TOKEN: "a" }, secretEnv: { TOKEN: "b" } }),
        fix: "false",
      }),
    )

    expect(getFailureMessage(hostSession)).toBe(
      "failed to compare the host with what the step wants -> failed to validate the options given to 'read' -> must be names in only one of env and secretEnv (was 'TOKEN')",
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
        { name: PRINT_SECRET, options: { maskOutput: true }, stdouts: ["[MASKED]"] },
        { name: "echo [MASKED]", options: {}, stdouts: ["[MASKED]\n"] },
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
      want: true,
      check: async ({ read }) => (await read(PRINT_SECRET, { maskOutput: true })) === SECRET,
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
        want: "",
        check: async ({ read }) => read("true", { maskOutput: castInvalid("yes") }),
        fix: "false",
      }),
    )

    expect(getFailureMessage(hostSession)).toBe(
      `failed to compare the host with what the step wants -> failed to validate the options given to 'read' -> maskOutput must be boolean (was "yes")`,
    )
  })
})

describe("tool calls", () => {
  it("should record a tool call on its command, with input as <content>", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run(
      "Call the tools",
      async ({ exec, inspect }) => {
        await exec("cat >/dev/null", { input: "x", maskOutput: true })
        await inspect("true")
      },
      { after: "always" },
    )

    expect(getRecordedToolCalls(hostSession)).toStrictEqual([
      {
        "cat >/dev/null": { toolName: "exec", options: { input: "<content>", maskOutput: true } },
        true: { toolName: "inspect", options: {} },
      },
    ])
  })

  it("should record no options for a call given only defaults", async () => {
    const hostSession = await createSession("plan")
    await hostSession.host.ensure("Check it", {
      want: "",
      check: async ({ read }) => read("true", { maskOutput: false }),
      fix: "false",
    })

    expect(getRecordedToolCalls(hostSession)).toStrictEqual([{ true: { toolName: "read", options: {} } }])
  })

  it("should record each of two calls run at once with its own options", async () => {
    const hostSession = await createSession("apply")
    await hostSession.host.run(
      "Call at once",
      async ({ exec }) => {
        await Promise.all([exec("cat >/dev/null", { input: "x" }), exec("true", { maskOutput: true })])
      },
      { after: "always" },
    )

    expect(getRecordedToolCalls(hostSession)).toStrictEqual([
      {
        "cat >/dev/null": { toolName: "exec", options: { input: "<content>" } },
        true: { toolName: "exec", options: { maskOutput: true } },
      },
    ])
  })

  it("should give each of two calls run at once only its own variables", async () => {
    const hostSession = await createSession("apply")
    let outputs: string[] = []
    await hostSession.host.run(
      "Call at once",
      async ({ exec }) => {
        outputs = await Promise.all([
          exec('printf %s "$V"', { env: { V: "a" } }),
          exec('printf "%s" "$V"', { env: { V: "b" } }),
        ])
      },
      { after: "always" },
    )

    expect({ outputs, toolCalls: getRecordedToolCalls(hostSession) }).toStrictEqual({
      outputs: ["a", "b"],
      toolCalls: [
        {
          'printf %s "$V"': { toolName: "exec", options: { env: { V: "a" } } },
          'printf "%s" "$V"': { toolName: "exec", options: { env: { V: "b" } } },
        },
      ],
    })
  })

  it("should record a read step's options on the step, and no tool call on its command", async () => {
    const hostSession = await createSession()
    await hostSession.host.read("cat >/dev/null", { input: "x", maskOutput: true })

    expect({
      options: getFinishedStepRecords(hostSession.hostRecord).map(({ options }) => options),
      toolCalls: getRecordedToolCalls(hostSession),
    }).toStrictEqual({
      options: [{ input: "<content>", maskOutput: true }],
      toolCalls: [{ "cat >/dev/null": undefined }],
    })
  })
})
