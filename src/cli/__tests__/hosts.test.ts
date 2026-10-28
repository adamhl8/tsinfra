import { expect, it, setDefaultTimeout } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

import { createProject, writeHosts } from "#cli/__tests__/utils.ts"

setDefaultTimeout(30_000)

it("selects every host when none are named", async () => {
  const { dir, run } = await createProject()
  await writeHosts(path.join(dir, "hosts"), ["b", "a"])

  const { stdout } = await run`tsinfra plan`

  expect(stdout).toBe("a\nb")
})

it("selects only the named hosts", async () => {
  const { dir, run } = await createProject()
  await writeHosts(path.join(dir, "hosts"), ["a", "b", "c"])

  const { stdout } = await run`tsinfra apply c a`

  expect(stdout).toBe("a\nc")
})

it("ignores files that aren't host files", async () => {
  const { dir, run } = await createProject()
  const hostsDir = path.join(dir, "hosts")
  await writeHosts(hostsDir, ["a"])
  await writeHosts(path.join(hostsDir, "lib"), ["b"])
  await Bun.write(path.join(hostsDir, "notes.md"), "")

  const { stdout } = await run`tsinfra plan`

  expect(stdout).toBe("a")
})

it("reads hosts from --hosts-dir", async () => {
  const { dir, run } = await createProject()
  await writeHosts(path.join(dir, "machines"), ["a"])

  const { stdout } = await run`tsinfra plan --hosts-dir machines`

  expect(stdout).toBe("a")
})

it("fails on an unknown host and lists the real ones", async () => {
  const { dir, run } = await createProject()
  await writeHosts(path.join(dir, "hosts"), ["a", "b"])

  const { stdout, stderr, exitCode } = await run`tsinfra plan a nope other`.nothrow()

  expect(exitCode).toBe(1)
  expect(stdout).toBe("")
  expect(stderr).toBe("error: unknown host: nope, other (hosts: a, b)")
})

it("fails when the hosts directory is missing", async () => {
  const { run } = await createProject()

  const { stdout, stderr, exitCode } = await run`tsinfra plan`.nothrow()

  expect(exitCode).toBe(1)
  expect(stdout).toBe("")
  expect(stderr).toStartWith("error: failed to read hosts directory 'hosts' -> ENOENT")
})

it("fails when the hosts directory has no host files", async () => {
  const { dir, run } = await createProject()
  await fs.mkdir(path.join(dir, "hosts"))

  const { stdout, stderr, exitCode } = await run`tsinfra plan`.nothrow()

  expect(exitCode).toBe(1)
  expect(stdout).toBe("")
  expect(stderr).toBe("error: no host files in 'hosts'")
})
