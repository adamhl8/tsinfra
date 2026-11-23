// Flatten an intersection into one object type, so a hover shows its keys.
// Intersect with `{}`, because a hover otherwise shows `Simplify<...>` around the intersection.
// oxlint-disable-next-line typescript/ban-types - the `{}` is what makes a hover show the flattened type
export type Simplify<T> = { [K in keyof T]: T[K] } & {}

// Leave out each key whose type is `never`.
// Map one object literal rather than intersect two, because an intersection's keys can show in any order in a hover.
export type WithoutNeverKeys<T> = { [K in keyof T as IsNever<T[K]> extends true ? never : K]: T[K] }

// Wrap `T` in a tuple, because a bare `T extends never` gives `never` for `never` instead of `true`.
export type IsNever<T> = [T] extends [never] ? true : false

/** `K` when it's an index signature's key type, like `string`, or nothing for a literal key. */
export type IndexSignatureKey<K> = string extends K ? K : never

/** `K` when it's a literal string key, like `"image"`, or nothing for an index signature's key type or a symbol. */
export type LiteralKey<K> = K extends string ? (string extends K ? never : K) : never
