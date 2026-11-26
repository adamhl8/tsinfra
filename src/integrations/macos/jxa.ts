/** An Objective-C object or pointer, as the JXA bridge hands it to a script. */
export interface ObjCRef {
  readonly __objCRef: unique symbol
}

/** The parts of the JXA `ObjC` global that the scripts use. */
export interface ObjCBridge {
  import: (framework: string) => void
  castRefToObject: (ref: ObjCRef) => ObjCRef
  unwrap: (ref: ObjCRef) => unknown
  deepUnwrap: (ref: ObjCRef) => unknown
  bindFunction: (name: string, signature: [returnType: string, argumentTypes: string[]]) => void
}

/**
 * Builds a JXA script that calls `fn` with `args` and prints its result as JSON. `fn` must be self-contained, because
 * only its own source reaches `osascript`. Takes `jxa` as `never` so a script can type the bridge parts it uses,
 * because `osascript` hands it the real `$` and `ObjC`.
 */
export const toJxa = <A extends unknown[]>(fn: (jxa: never, ...args: A) => unknown, ...args: A) =>
  `JSON.stringify((${fn.toString()})({ $, ObjC }, ...${JSON.stringify(args)}))`

// Pass the script through `env`, because its quotes and `$` would need escaping in the command text.
export const OSASCRIPT = 'osascript -l JavaScript -e "$SCRIPT"'
