import type { HandlerLookup, HandlerLookups } from "#integrations/macos/file-handlers/launch-services.ts"

// Match the prefix of a type macOS makes up for an extension nothing declares.
const DYNAMIC_TYPE_PREFIX = "dyn."

/** Returns whether macOS made up `contentType` because nothing declares it. */
export const isDynamicType = (contentType: string) => contentType.startsWith(DYNAMIC_TYPE_PREFIX)

/** Returns the app to open each extension with. Throws when an app's path or an extension isn't one, or repeats. */
export const toExtensionApps = (handlers: Record<string, string[]>): Record<string, string> => {
  const extensionApps: Record<string, string> = {}
  for (const [app, extensions] of Object.entries(handlers)) {
    if (!app.endsWith(".app")) throw new Error(`'${app}' isn't a path to an app, because it doesn't end in '.app'`)
    for (const extension of extensions) {
      if (extension.includes(".")) throw new Error(`Extension '${extension}' has a dot, so write it without one`)
      const name = extension.toLowerCase()
      const otherApp = extensionApps[name]
      if (otherApp !== undefined && otherApp !== app)
        throw new Error(`Extension '${name}' is listed under both '${otherApp}' and '${app}'`)
      extensionApps[name] = app
    }
  }
  return extensionApps
}

const assertTypesAgree = (extensionApps: Record<string, string>, lookups: HandlerLookups) => {
  const firstExtensions: Record<string, string> = {}
  for (const [extension, { contentType }] of Object.entries(lookups)) {
    const firstExtension = firstExtensions[contentType] ?? extension
    firstExtensions[contentType] = firstExtension
    if (extensionApps[firstExtension] !== extensionApps[extension]) {
      throw new Error(
        `Extensions '${firstExtension}' and '${extension}' are the same type to macOS, '${contentType}', but are listed under different apps`,
      )
    }
  }
}

const toHandler = (extension: string, app: string, lookup: HandlerLookup): string | undefined => {
  const { contentType, app: wantedApp, handler } = lookup
  if (wantedApp === undefined) throw new Error(`'${app}' isn't an installed app`)
  if (isDynamicType(contentType))
    throw new Error(`macOS has no content type for extension '${extension}', so nothing can be set for it`)
  if (handler === undefined) return undefined

  // Compare bundle IDs lowercased because Launch Services matches them without regard to case.
  const isWantedApp = handler.bundleId.toLowerCase() === wantedApp.bundleId.toLowerCase()
  return isWantedApp ? app : (handler.path ?? handler.bundleId)
}

/**
 * Returns what the check reports: the path of the app that opens each extension in `extensionApps`, leaving out an
 * extension nothing opens. Throws when one can't be set.
 */
export const toCheckRecord = (
  extensionApps: Record<string, string>,
  lookups: HandlerLookups,
): Record<string, string> => {
  const handlers: Record<string, string> = {}
  for (const [extension, lookup] of Object.entries(lookups)) {
    const handler = toHandler(extension, extensionApps[extension] ?? "", lookup)
    if (handler !== undefined) handlers[extension] = handler
  }
  assertTypesAgree(extensionApps, lookups)
  return handlers
}
