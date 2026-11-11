import { describe, expect, it } from "bun:test"
import { readdir } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"

import { createSession, fileOrMessage, prepareAndRunHost, toLoadedHost } from "#__tests__/session.ts"
import { host } from "#hosts/host.ts"
import { renderHostBlock, toHostBlock } from "#report/report.ts"

describe("a user with no sudo rule", () => {
  it("should fail straight away when a step needs sudo", async () => {
    const { host: h } = await createSession("plan")

    expect(await fileOrMessage(h, "/etc/tsinfra-docker-x", "a\n", { sudo: true })).toBe(
      "failed to compare the host with what the step wants -> failed to read the details of '/etc/tsinfra-docker-x' -> exited with code 1: sudo: a password is required",
    )
  })

  it("should hint at the sudo option when a step's sudo needs a password", async () => {
    const hostRecord = await prepareAndRunHost(
      toLoadedHost(
        "a",
        host("@local", async (h) => {
          await h.file("/etc/tsinfra-docker-x", "a\n", { sudo: true })
        }),
      ),
      "plan",
    )

    expect(renderHostBlock(toHostBlock(hostRecord, {}))).toContain(
      "sudo needs a password on this host, so set the sudo option on host()",
    )
  })

  it("should make a script's own sudo fail instead of prompting", async () => {
    const { host: h } = await createSession("plan")

    expect(await h.inspect("sudo true")).toStrictEqual({
      stdout: "",
      stderr: "sudo: a password is required",
      exitCode: 1,
    })
  })

  it("should fail at chown on a group the user isn't in, and leave no temp file", async () => {
    const directory = await makeTempDir()
    const filePath = path.join(directory, "app.conf")
    const { host: h } = await createSession("apply")

    expect(await fileOrMessage(h, filePath, "a\n", { group: "sonarr" })).toStartWith(
      `failed to run the fix -> failed to write '${filePath}' -> exited with code 1: chown: `,
    )
    expect(await readdir(directory)).toStrictEqual([])
  })
})
