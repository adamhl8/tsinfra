import type { NonRecordValue, Simplify } from "#core/session/handlers/ensure/comparison/record/difference.ts"

/** `want` with only what the host doesn't match, at any depth, so each literal key is optional. */
export type UnmetRecord<T> = Simplify<UnmetIndexSignature<T> & UnmetLiteralKeys<T>>

// Keep an index signature as one, so `Object.values` doesn't add `undefined`.
// Map it rather than test `keyof T`, because a conditional drops the index signature where a recursive type repeats.
type UnmetIndexSignature<T> = {
  readonly [K in keyof T as IndexSignatureKey<K>]: UnmetValue<Exclude<T[K], undefined>>
}

type UnmetLiteralKeys<T> = {
  readonly [K in keyof T as LiteralKey<K>]?: UnmetValue<Exclude<T[K], undefined>>
}

// Keep a primitive, a list, or a set as `want`'s type, because a set holds its missing items and the others stay whole.
type UnmetValue<V> = V extends NonRecordValue ? V : UnmetRecord<V>

/** `K` when it's an index signature's key type, like `string`, or nothing for a literal key. */
type IndexSignatureKey<K> = string extends K ? K : never

/** `K` when it's a literal string key, like `"image"`, or nothing for an index signature's key type or a symbol. */
type LiteralKey<K> = K extends string ? (string extends K ? never : K) : never
