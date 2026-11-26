import { describe, expect, it } from "bun:test"
import process from "node:process"

import { $ } from "bun"

import {
  handlerLookupsSchema,
  lookUpHandlers,
  pendingExtensionsSchema,
  waitForHandlers,
} from "#integrations/macos/file-handlers/launch-services.ts"
import { toJxa } from "#integrations/macos/jxa.ts"

const PREVIEW = "/System/Applications/Preview.app"
const TEXT_EDIT = "/System/Applications/TextEdit.app"
const TIMEOUT_MS = 30_000

// Use an extension every Mac has an app for, so there's a current app to compare against.
const EXTENSION = "workflow"

const runJxa = async (script: string) => $`osascript -l JavaScript -e ${script}`.quiet().text()

const readCurrentApp = async (extension: string) => {
  // Pass any app, because only the current handler is read.
  const output = await runJxa(toJxa(lookUpHandlers, { [extension]: TEXT_EDIT }))
  const validLookups = handlerLookupsSchema.assert(output)
  return validLookups[extension]?.handler?.path ?? ""
}

// Only wait, because waiting never changes a handler.
const waitForApps = async (extensionApps: Record<string, string>, timeoutSeconds: number) => {
  const startedAt = Date.now()
  const output = await runJxa(toJxa(waitForHandlers, extensionApps, timeoutSeconds))
  const elapsedMs = Date.now() - startedAt
  const validPending = pendingExtensionsSchema.assert(output)
  return { pending: validPending, elapsedMs }
}

describe.skipIf(process.platform !== "darwin")("waitForHandlers", () => {
  it(
    "should report no pending extension when the wanted app already opens it",
    async () => {
      const currentApp = await readCurrentApp(EXTENSION)
      const run = await waitForApps({ [EXTENSION]: currentApp }, 0)

      expect(run.pending).toStrictEqual([])
    },
    TIMEOUT_MS,
  )

  it(
    "should report an extension another app still opens once the wait runs out",
    async () => {
      const currentApp = await readCurrentApp(EXTENSION)
      const otherApp = currentApp === TEXT_EDIT ? PREVIEW : TEXT_EDIT
      const run = await waitForApps({ [EXTENSION]: otherApp }, 1)

      expect(run.pending).toStrictEqual([EXTENSION])
      expect(run.elapsedMs).toBeGreaterThanOrEqual(1000)
    },
    TIMEOUT_MS,
  )
})
