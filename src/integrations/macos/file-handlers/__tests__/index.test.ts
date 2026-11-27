import { describe, expect, it } from "bun:test"
import process from "node:process"

import { attempt, isErr, messageChain } from "ts-explicit-errors"

import { createSession, createSessionWithFacts, getStepRecords } from "#core/__tests__/session.ts"
import type { Host } from "#core/session.ts"
import { getFinishedStepRecords } from "#core/session/recorder/records.ts"
import { fileHandlers, readInfoPlist, readKnownExtensions } from "#integrations/macos/file-handlers/index.ts"
import { getOwnValue } from "#utils.ts"

const PREVIEW = "/System/Applications/Preview.app"
const TEXT_EDIT = "/System/Applications/TextEdit.app"
const TIMEOUT_MS = 30_000

// Only plan, because applying would change this Mac's own handlers.
const planHandlers = async (handlers: Record<string, string[]>) => {
  const { host: h, hostRecord } = await createSession("plan")
  const result = await attempt(async () => fileHandlers(h, handlers))
  if (isErr(result)) return { changed: undefined, got: undefined, message: messageChain(result) }

  const stepRecord = getFinishedStepRecords(hostRecord).find(({ name }) => name === "File handlers")
  const values = stepRecord?.comparisons.before?.values
  const got = values?.kind === "record" ? values.got : undefined
  return { changed: result.changed, got, message: undefined }
}

describe.skipIf(process.platform !== "darwin")("fileHandlers", () => {
  it(
    "should plan a change for an extension another app opens, and none for the app that opens it",
    async () => {
      const change = await planHandlers({ [TEXT_EDIT]: ["workflow"] })
      // Take the current app from the plan, because it depends on what's installed.
      const currentApp = getOwnValue(change.got, "workflow")
      if (typeof currentApp !== "string") throw new TypeError("the plan found no app for 'workflow'")
      const otherApp = currentApp === TEXT_EDIT ? PREVIEW : TEXT_EDIT
      const otherChange = await planHandlers({ [otherApp]: ["workflow"] })
      const noChange = await planHandlers({ [currentApp]: ["workflow"] })

      expect(otherChange.changed).toBe(true)
      expect(noChange.changed).toBe(false)
    },
    TIMEOUT_MS,
  )

  it(
    "should fail the plan for an app that isn't installed",
    async () => {
      const { message } = await planHandlers({ "/Applications/Not Installed.app": ["pdf"] })

      expect(message).toContain("'/Applications/Not Installed.app' isn't an installed app")
    },
    TIMEOUT_MS,
  )

  it(
    "should fail the plan for an extension macOS has no type for",
    async () => {
      const { message } = await planHandlers({ [PREVIEW]: ["nosuchextension"] })

      expect(message).toContain("macOS has no content type for extension 'nosuchextension'")
    },
    TIMEOUT_MS,
  )

  it(
    "should fail the plan for extensions that share a type under two apps",
    async () => {
      const { message } = await planHandlers({ [PREVIEW]: ["jpg"], [TEXT_EDIT]: ["jpeg"] })

      expect(message).toContain("Extensions 'jpg' and 'jpeg' are the same type to macOS, 'public.jpeg'")
    },
    TIMEOUT_MS,
  )

  it("should fail before the step for a path that isn't an app's", async () => {
    const { message } = await planHandlers({ "/Applications/Preview": ["pdf"] })

    expect(message).toBe("'/Applications/Preview' isn't a path to an app, because it doesn't end in '.app'")
  })
})

describe.skipIf(process.platform !== "darwin")("readKnownExtensions", () => {
  it("should keep only the extensions macOS has a content type for", async () => {
    const { host: h } = await createSession("plan")

    expect(await readKnownExtensions(h, ["pdf", "nosuchextension", "txt"])).toStrictEqual(["pdf", "txt"])
  })
})

describe.skipIf(process.platform !== "darwin")("readInfoPlist", () => {
  it("should return a string key of an app's Info.plist", async () => {
    const { host: h } = await createSession("plan")

    expect(await readInfoPlist(h, PREVIEW, "CFBundleIdentifier")).toBe("com.apple.Preview")
  })

  it("should return an array key of an app's Info.plist", async () => {
    const { host: h } = await createSession("plan")
    const documentTypes = await readInfoPlist(h, PREVIEW, "CFBundleDocumentTypes")

    expect(Array.isArray(documentTypes) && documentTypes.length > 0).toBe(true)
  })

  it("should return undefined for an app that isn't installed", async () => {
    const { host: h } = await createSession("plan")

    expect(await readInfoPlist(h, "/Applications/Not Installed.app", "CFBundleIdentifier")).toBeUndefined()
  })

  it("should throw for a key the app doesn't have", async () => {
    const { host: h } = await createSession("plan")
    const result = await attempt(async () => readInfoPlist(h, PREVIEW, "NoSuchKey"))

    expect(isErr(result) ? result.message : result).toBe(`The app at '${PREVIEW}' has no 'NoSuchKey' in its Info.plist`)
  })
})

describe("the file handlers functions on a host that isn't a Mac", () => {
  it.each([
    ["fileHandlers", async (h: Host) => fileHandlers(h, { [PREVIEW]: ["pdf"] })],
    ["readKnownExtensions", async (h: Host) => readKnownExtensions(h, ["pdf"])],
    ["readInfoPlist", async (h: Host) => readInfoPlist(h, PREVIEW, "CFBundleIdentifier")],
  ])("should stop %p before it runs anything", async (name, call) => {
    const { host: h, hostRecord } = await createSessionWithFacts("plan", { platform: "linux" })
    const result = await attempt(async () => call(h))

    expect(isErr(result) ? result.message : result).toBe(
      `The '${name}' integration needs a 'darwin' host, but this host is 'linux'`,
    )
    expect(getStepRecords(hostRecord)).toStrictEqual([])
  })
})
