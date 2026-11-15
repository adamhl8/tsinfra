import { describe, expect, it } from "bun:test"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"

import { makeTempDir } from "@adamhl8/configs/test"
import bun from "bun"
import type { Result } from "ts-explicit-errors"
import { isErr, messageChain } from "ts-explicit-errors"

import { createSavedStateManager } from "#session/saved-state/saved-state.ts"
import { createShell, getLocalTransport } from "#transport/transport.ts"

const OCTAL_RADIX = 8

const localShell = createShell(getLocalTransport())

// Put a quote and a space above `.tsinfra`, so a path that isn't quoted breaks the scripts.
const createSavedStatePath = async () => path.join(await makeTempDir(), "it's here", ".tsinfra", "state", "a.json")

/** Creates a manager for `savedStatePath` on `@local`, or throws why it couldn't. */
const createManager = async (savedStatePath: string, shell = localShell) => {
  const manager = await createSavedStateManager(shell, savedStatePath)
  if (isErr(manager)) throw manager
  return manager
}

/** Returns the message chain of why a manager couldn't be created for `savedStatePath`. */
const getCreateMessage = async (savedStatePath: string) => {
  const manager = await createSavedStateManager(localShell, savedStatePath)
  return isErr(manager) ? messageChain(manager) : "created"
}

/** Returns a shell on `@local` that keeps each command it runs, so a test can see which writes ran. */
const createCountingShell = () => {
  const commands: string[] = []
  const localTransport = getLocalTransport()
  const shell = createShell(async (cmd) => {
    commands.push(cmd)
    return localTransport(cmd)
  })
  return { shell, commands }
}

/** Returns what a result failed with, as its message chain, or `succeeded`. */
const toMessage = (result: Result) => (isErr(result) ? messageChain(result) : "succeeded")

const getMode = async (filePath: string) => (await stat(filePath)).mode.toString(OCTAL_RADIX).slice(-3)

describe("createSavedStateManager", () => {
  it("should keep open changes and the runs after them for the next manager to read", async () => {
    const savedStatePath = await createSavedStatePath()
    const manager = await createManager(savedStatePath)
    await manager.openChange("Caddyfile")
    await manager.openChange("Unit")
    await manager.recordFollowUp("Restart caddy", ["Caddyfile", "Not open"])

    const nextManager = await createManager(savedStatePath)

    expect(await bun.file(savedStatePath).json()).toStrictEqual({
      version: 1,
      openChanges: { Caddyfile: ["Restart caddy"], Unit: [] },
    })
    expect([nextManager.isOpen("Caddyfile"), nextManager.isOpen("Unit"), nextManager.isOpen("Not open")]).toStrictEqual(
      [true, true, false],
    )
    expect(nextManager.getOpenChangesForFollowUp("Restart caddy", ["Caddyfile", "Unit", "Not open"])).toStrictEqual([
      "Unit",
    ])
  })

  it("should open a fresh change for a step whose change is already open", async () => {
    const manager = await createManager(await createSavedStatePath())
    await manager.openChange("Caddyfile")
    await manager.recordFollowUp("Restart caddy", ["Caddyfile"])
    await manager.openChange("Caddyfile")

    expect(manager.getOpenChangesForFollowUp("Restart caddy", ["Caddyfile"])).toStrictEqual(["Caddyfile"])
  })

  it("should have no open changes when there's no file, and write nothing to find that out", async () => {
    const savedStatePath = await createSavedStatePath()
    const manager = await createManager(savedStatePath)

    expect([
      manager.isOpen("Caddyfile"),
      manager.getOpenChangesForFollowUp("Restart caddy", ["Caddyfile"]),
    ]).toStrictEqual([false, []])
    expect(await bun.file(savedStatePath).exists()).toBe(false)
  })

  it("should write the file as 600, and every directory it creates as 700", async () => {
    const savedStatePath = await createSavedStatePath()
    const stateDirectory = path.dirname(savedStatePath)
    const tsinfraDirectory = path.dirname(stateDirectory)
    const manager = await createManager(savedStatePath)
    await manager.openChange("Caddyfile")

    const createdPaths = [savedStatePath, stateDirectory, tsinfraDirectory, path.dirname(tsinfraDirectory)]
    expect(await Promise.all(createdPaths.map(getMode))).toStrictEqual(["600", "700", "700", "700"])
  })

  it("should delete the file when every change closes", async () => {
    const savedStatePath = await createSavedStatePath()
    const manager = await createManager(savedStatePath)
    await manager.openChange("Caddyfile")
    await manager.closeAll()

    expect([await bun.file(savedStatePath).exists(), manager.isOpen("Caddyfile")]).toStrictEqual([false, false])
  })

  it("should skip a write or a delete that wouldn't change the file", async () => {
    const { shell, commands } = createCountingShell()
    const manager = await createManager(await createSavedStatePath(), shell)
    await manager.closeAll()
    await manager.openChange("Caddyfile")
    await manager.openChange("Caddyfile")
    await manager.recordFollowUp("Restart caddy", ["Caddyfile"])
    await manager.recordFollowUp("Restart caddy", ["Caddyfile", "Not open"])

    // Count the read, the first open, and the first record, because the rest change nothing.
    expect(commands).toHaveLength(3)
  })

  it("should fail with the file's path when the file isn't JSON", async () => {
    const savedStatePath = await createSavedStatePath()
    await bun.write(savedStatePath, "{")

    expect(await getCreateMessage(savedStatePath)).toStartWith(
      `the saved state in '${savedStatePath}' isn't saved state tsinfra wrote -> must be a JSON string (SyntaxError: `,
    )
  })

  it("should fail with the file's path when the file has another shape or version", async () => {
    const wrongShapePath = await createSavedStatePath()
    const wrongVersionPath = await createSavedStatePath()
    await bun.write(wrongShapePath, JSON.stringify({ version: 1, openChanges: { Caddyfile: "Restart caddy" } }))
    await bun.write(wrongVersionPath, JSON.stringify({ version: 2, openChanges: {} }))

    expect([await getCreateMessage(wrongShapePath), await getCreateMessage(wrongVersionPath)]).toStrictEqual([
      `the saved state in '${wrongShapePath}' isn't saved state tsinfra wrote -> openChanges.Caddyfile must be an array (was string)`,
      `the saved state in '${wrongVersionPath}' isn't saved state tsinfra wrote -> version must be 1 (was 2)`,
    ])
  })

  it("should fail with the file's path when the file can't be read", async () => {
    const savedStatePath = await createSavedStatePath()
    await mkdir(savedStatePath, { recursive: true })

    expect(await getCreateMessage(savedStatePath)).toStartWith(
      `failed to read the saved state in '${savedStatePath}' -> `,
    )
  })

  it("should fail with the file's path when a write fails", async () => {
    const savedStatePath = await createSavedStatePath()
    const manager = await createManager(savedStatePath)
    // Put a file where the state directory goes, so the write's `mkdir -p` fails.
    await bun.write(path.dirname(savedStatePath), "")

    const openResult = await manager.openChange("Caddyfile")

    expect(toMessage(openResult)).toStartWith(`failed to write the saved state to '${savedStatePath}' -> `)
    expect(manager.isOpen("Caddyfile")).toBe(false)
  })

  it("should fail with the file's path when the delete fails", async () => {
    const savedStatePath = await createSavedStatePath()
    const manager = await createManager(savedStatePath)
    await manager.openChange("Caddyfile")
    // Put a directory where the file was, so the delete's `rm -f` fails.
    await bun.file(savedStatePath).delete()
    await mkdir(savedStatePath)

    const closeResult = await manager.closeAll()

    expect(toMessage(closeResult)).toStartWith(`failed to delete the saved state in '${savedStatePath}' -> `)
  })
})
