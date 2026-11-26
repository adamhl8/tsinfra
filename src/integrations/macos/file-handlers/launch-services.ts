// oxlint-disable new-cap - Launch Services names its functions in PascalCase
import { type } from "arktype"

import type { ObjCBridge, ObjCRef } from "#integrations/macos/jxa.ts"

/** The parts of the JXA bridge that the Launch Services scripts use. */
interface LaunchServicesJxa {
  $: {
    (value?: string): NSStringRef
    kLSRolesAll: number
    LSCopyDefaultRoleHandlerForContentType: (contentType: ObjCRef, role: number) => ObjCRef
    LSSetDefaultRoleHandlerForContentType: (contentType: ObjCRef, role: number, bundleId: ObjCRef) => number
    NSBundle: { bundleWithPath: (path: ObjCRef) => BundleRef }
    NSThread: { sleepForTimeInterval: (seconds: number) => void }
    NSWorkspace: { sharedWorkspace: { URLForApplicationWithBundleIdentifier: (bundleId: ObjCRef) => UrlRef } }
    UTTypeCreatePreferredIdentifierForTag: (tagClass: ObjCRef, tag: ObjCRef, conformsTo: ObjCRef) => ObjCRef
  }
  ObjC: ObjCBridge
}

interface NullableRef extends ObjCRef {
  isNil: () => boolean
}

interface NSStringRef extends NullableRef {
  js: string
  stringByExpandingTildeInPath: NSStringRef
}

interface BundleRef extends NullableRef {
  bundleIdentifier: NSStringRef
}

interface UrlRef extends NullableRef {
  path: NSStringRef
}

const handlerLookupSchema = type({
  contentType: "string",
  "app?": { bundleId: "string" },
  "handler?": { bundleId: "string", "path?": "string" },
})

/** An extension's content type, the app wanted for it, and the app that opens it now. */
export interface HandlerLookup {
  contentType: string
  /** Left out when nothing at the app's path is an app. */
  app?: { bundleId: string } | undefined
  /** Left out when nothing opens the extension. */
  handler?: { bundleId: string; path?: string | undefined } | undefined
}

export type HandlerLookups = Record<string, HandlerLookup>

export const handlerLookupsSchema = type("string.json.parse").to(type({ "[string]": handlerLookupSchema }))

export const contentTypesSchema = type("string.json.parse").to({ "[string]": "string" })

export const pendingExtensionsSchema = type("string.json.parse").to("string[]")

/** Returns the content type macOS gives each of `extensions`. */
export const lookUpContentTypes = (jxa: LaunchServicesJxa, extensions: string[]) => {
  const { $, ObjC } = jxa
  ObjC.import("CoreServices")
  const contentTypes: Record<string, unknown> = {}
  for (const extension of extensions) {
    const tagClass = $("public.filename-extension")
    const typeRef = $.UTTypeCreatePreferredIdentifierForTag(tagClass, $(extension), $())
    contentTypes[extension] = ObjC.unwrap(ObjC.castRefToObject(typeRef))
  }
  return contentTypes
}

/** Looks up each extension in `extensionApps`, which gives the path of the app wanted for it. */
export const lookUpHandlers = (jxa: LaunchServicesJxa, extensionApps: Record<string, string>) => {
  const { $, ObjC } = jxa
  ObjC.import("AppKit")
  ObjC.import("CoreServices")
  const toString = (ref: ObjCRef) => {
    const value = ObjC.unwrap(ObjC.castRefToObject(ref))
    return typeof value === "string" ? value : undefined
  }
  const readApp = (path: string) => {
    const bundle = $.NSBundle.bundleWithPath($(path).stringByExpandingTildeInPath)
    if (bundle.isNil() || bundle.bundleIdentifier.isNil()) return
    return { bundleId: bundle.bundleIdentifier.js }
  }
  const readHandler = (contentType: string) => {
    const bundleId = toString($.LSCopyDefaultRoleHandlerForContentType($(contentType), $.kLSRolesAll))
    if (bundleId === undefined) return
    const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier($(bundleId))
    return { bundleId, path: url.isNil() ? undefined : url.path.js }
  }

  const lookups: Record<string, unknown> = {}
  for (const [extension, appPath] of Object.entries(extensionApps)) {
    const tagClass = $("public.filename-extension")
    const contentType = toString($.UTTypeCreatePreferredIdentifierForTag(tagClass, $(extension), $())) ?? ""
    lookups[extension] = { contentType, app: readApp(appPath), handler: readHandler(contentType) }
  }
  return lookups
}

/**
 * Checks every 2 seconds, for up to `timeoutSeconds`, until each app in `extensionApps` opens its extension. Returns
 * the extensions another app still opens.
 */
export const waitForHandlers = (
  jxa: LaunchServicesJxa,
  extensionApps: Record<string, string>,
  timeoutSeconds: number,
) => {
  const { $, ObjC } = jxa
  ObjC.import("AppKit")
  ObjC.import("CoreServices")
  const toString = (ref: ObjCRef) => {
    const value = ObjC.unwrap(ObjC.castRefToObject(ref))
    return typeof value === "string" ? value : undefined
  }
  const wanted = Object.entries(extensionApps).map(([extension, appPath]) => {
    const tagClass = $("public.filename-extension")
    const contentType = toString($.UTTypeCreatePreferredIdentifierForTag(tagClass, $(extension), $())) ?? ""
    const { bundleIdentifier } = $.NSBundle.bundleWithPath($(appPath).stringByExpandingTildeInPath)
    // Compare bundle IDs lowercased because Launch Services matches them without regard to case.
    const bundleId = bundleIdentifier.js.toLowerCase()
    return { extension, contentType, bundleId }
  })

  const deadline = Date.now() + timeoutSeconds * 1000
  for (;;) {
    const pending = wanted
      .filter(({ contentType, bundleId }) => {
        const handler = toString($.LSCopyDefaultRoleHandlerForContentType($(contentType), $.kLSRolesAll))
        const isWantedApp = handler?.toLowerCase() === bundleId
        return !isWantedApp
      })
      .map(({ extension }) => extension)
    if (pending.length === 0 || Date.now() >= deadline) return pending
    $.NSThread.sleepForTimeInterval(2)
  }
}

/**
 * Asks Launch Services to make each app in `extensionApps` open its extension. Throws when it refuses one. macOS may
 * ask the user first, and then applies the change after they agree, so `waitForHandlers` confirms it.
 */
export const setHandlers = (jxa: LaunchServicesJxa, extensionApps: Record<string, string>) => {
  const { $, ObjC } = jxa
  ObjC.import("AppKit")
  ObjC.import("CoreServices")
  for (const [extension, appPath] of Object.entries(extensionApps)) {
    const tagClass = $("public.filename-extension")
    const contentTypeRef = $.UTTypeCreatePreferredIdentifierForTag(tagClass, $(extension), $())
    const contentType = String(ObjC.unwrap(ObjC.castRefToObject(contentTypeRef)))
    const { bundleIdentifier } = $.NSBundle.bundleWithPath($(appPath).stringByExpandingTildeInPath)
    const status = $.LSSetDefaultRoleHandlerForContentType($(contentType), $.kLSRolesAll, bundleIdentifier)
    if (status !== 0)
      throw new Error(`Launch Services rejected '${appPath}' for '${extension}' (${contentType}) with status ${status}`)
  }
}
