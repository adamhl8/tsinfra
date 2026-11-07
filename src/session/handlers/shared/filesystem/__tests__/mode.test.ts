import { describe, expect, it } from "bun:test"

import type { FileMode } from "#session/handlers/shared/filesystem/mode.ts"
import {
  GROUP_EXECUTABLE_MODE,
  GROUP_FILE_MODE,
  PRIVATE_EXECUTABLE_MODE,
  PRIVATE_FILE_MODE,
  PUBLIC_EXECUTABLE_MODE,
  PUBLIC_FILE_MODE,
  toModeBits,
  parseFileMode,
  toOctalMode,
  toSymbolicMode,
} from "#session/handlers/shared/filesystem/mode.ts"

describe("parseFileMode", () => {
  it("should read an octal mode, with or without a leading digit for the special bits", () => {
    expect([parseFileMode("644"), parseFileMode("0644"), parseFileMode("4755")]).toStrictEqual(
      [0o644, 0o644, 0o4755].map((bits) => toModeBits(bits)),
    )
  })

  it("should read a symbolic mode", () => {
    expect([parseFileMode("rw-r--r--"), parseFileMode("rwxr-x---"), parseFileMode("---------")]).toStrictEqual(
      [0o644, 0o750, 0].map((bits) => toModeBits(bits)),
    )
  })

  it("should read s, S, t, and T as the special bits, with execute only for the lowercase ones", () => {
    expect([parseFileMode("rwsr-sr-t"), parseFileMode("rwSr--r-T")]).toStrictEqual(
      [0o7755, 0o5644].map((bits) => toModeBits(bits)),
    )
  })

  it("should give each named mode the octal mode its doc names", () => {
    const modes: FileMode[] = [
      PUBLIC_FILE_MODE,
      GROUP_FILE_MODE,
      PRIVATE_FILE_MODE,
      PUBLIC_EXECUTABLE_MODE,
      GROUP_EXECUTABLE_MODE,
      PRIVATE_EXECUTABLE_MODE,
    ]

    expect(modes.map((mode) => parseFileMode(mode))).toStrictEqual(
      [0o644, 0o640, 0o600, 0o755, 0o750, 0o700].map((bits) => toModeBits(bits)),
    )
  })
})

describe("toOctalMode", () => {
  it("should keep three digits, and a fourth for the special bits", () => {
    expect([0o644, 0o44, 0o4755].map((bits) => toOctalMode(toModeBits(bits)))).toStrictEqual(["644", "044", "4755"])
  })
})

describe("toSymbolicMode", () => {
  it("should return the mode the way ls prints it", () => {
    expect([0o644, 0o44].map((bits) => toSymbolicMode(toModeBits(bits)))).toStrictEqual(["rw-r--r--", "---r--r--"])
  })

  it("should show the special bits, in capitals when the execute bit isn't set", () => {
    expect([0o7755, 0o5644].map((bits) => toSymbolicMode(toModeBits(bits)))).toStrictEqual(["rwsr-sr-t", "rwSr--r-T"])
  })
})
