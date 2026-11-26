import { type } from "arktype"

import type { ObjCBridge, ObjCRef } from "#integrations/macos/jxa.ts"

/** The parts of the JXA bridge that the `Info.plist` script uses. */
interface InfoPlistJxa {
  $: {
    (value: string): NSStringRef
    NSBundle: { bundleWithPath: (path: ObjCRef) => BundleRef }
  }
  ObjC: ObjCBridge
}

interface NullableRef extends ObjCRef {
  isNil: () => boolean
}

interface NSStringRef extends NullableRef {
  stringByExpandingTildeInPath: NSStringRef
}

interface BundleRef extends NullableRef {
  infoDictionary: { objectForKey: (key: ObjCRef) => NullableRef }
}

/** What the script found: no app at the path, an app without the key, or the key's value. */
export const infoPlistLookupSchema = type("string.json.parse").to(
  type({ kind: "'noApp'" }).or({ kind: "'noKey'" }).or({ kind: "'found'", value: "unknown" }),
)

/** Reads `key` from the `Info.plist` of the app at `appPath`. */
export const lookUpInfoPlistKey = (jxa: InfoPlistJxa, appPath: string, key: string) => {
  const { $, ObjC } = jxa
  ObjC.import("Foundation")
  const bundle = $.NSBundle.bundleWithPath($(appPath).stringByExpandingTildeInPath)
  if (bundle.isNil()) return { kind: "noApp" }
  const value = bundle.infoDictionary.objectForKey($(key))
  return value.isNil() ? { kind: "noKey" } : { kind: "found", value: ObjC.deepUnwrap(value) }
}
