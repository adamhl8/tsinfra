import type { Host } from "#core/session.ts"
import type { StepNeeds } from "#core/session/handlers/options/step.ts"
import { isDynamicType, toCheckRecord, toExtensionApps } from "#integrations/macos/file-handlers/extensions.ts"
import { infoPlistLookupSchema, lookUpInfoPlistKey } from "#integrations/macos/file-handlers/info-plist.ts"
import {
  contentTypesSchema,
  handlerLookupsSchema,
  lookUpContentTypes,
  lookUpHandlers,
  pendingExtensionsSchema,
  setHandlers,
  waitForHandlers,
} from "#integrations/macos/file-handlers/launch-services.ts"
import { OSASCRIPT, toJxa } from "#integrations/macos/jxa.ts"

// Give the user time to answer a prompt for each change.
const APPROVAL_TIMEOUT_MINUTES = 5

/** The options `fileHandlers` takes. */
export interface FileHandlersOptions {
  /** The steps that install the apps. The plan waits for them instead of failing on an app that isn't there yet. */
  needs?: StepNeeds
}

/**
 * Sets the app that opens each file extension, given as `{ appPath: extensions }`. It goes through the Launch Services
 * API, because `lsd` keeps handlers in memory and overwrites edits to its plist.
 */
export const fileHandlers = async (h: Host, handlers: Record<string, string[]>, options: FileHandlersOptions = {}) => {
  const { needs = [] } = options
  const extensionApps = toExtensionApps(handlers)

  return h.ensure("File handlers", {
    needs,
    want: extensionApps,
    // Look up everything here, not before the step, so `needs` covers it.
    check: async ({ read }) => {
      const script = toJxa(lookUpHandlers, extensionApps)
      const output = await read(OSASCRIPT, { env: { SCRIPT: script } })
      const validLookups = handlerLookupsSchema.assert(output)
      return toCheckRecord(extensionApps, validLookups)
    },
    fix: async ({ exec }, { unmet }) => {
      // Send every request at once, because macOS groups some of them into one prompt.
      const setScript = toJxa(setHandlers, unmet)
      await exec(OSASCRIPT, { env: { SCRIPT: setScript } })

      const waitScript = toJxa(waitForHandlers, unmet, APPROVAL_TIMEOUT_MINUTES * 60)
      const waitOutput = await exec(OSASCRIPT, { env: { SCRIPT: waitScript } })
      const validPending = pendingExtensionsSchema.assert(waitOutput)
      const pendingList = validPending.join(", ")
      if (validPending.length > 0) {
        throw new Error(
          `The changes for these extensions weren't approved in macOS's prompts within ${APPROVAL_TIMEOUT_MINUTES} minutes: ${pendingList}`,
        )
      }
    },
  })
}

/** Returns the ones in `extensions` that macOS has a content type for, so `fileHandlers` can set them. */
export const readKnownExtensions = async (h: Host, extensions: string[]): Promise<string[]> => {
  const script = toJxa(lookUpContentTypes, extensions)
  const output = await h.read(OSASCRIPT, { env: { SCRIPT: script } })
  const contentTypes = contentTypesSchema.assert(output)
  return extensions.filter((extension) => !isDynamicType(contentTypes[extension] ?? ""))
}

/**
 * Returns a key of the `Info.plist` of the app at `appPath`, or undefined when there's no app. Fails when the app
 * doesn't have the key.
 */
export const readInfoPlist = async (h: Host, appPath: string, key: string): Promise<unknown> => {
  const script = toJxa(lookUpInfoPlistKey, appPath, key)
  const output = await h.read(OSASCRIPT, { env: { SCRIPT: script } })
  const lookup = infoPlistLookupSchema.assert(output)
  if (lookup.kind === "noApp") return undefined
  if (lookup.kind === "noKey") throw new Error(`The app at '${appPath}' has no '${key}' in its Info.plist`)
  return lookup.value
}
