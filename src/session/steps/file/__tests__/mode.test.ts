import { describe, expect, it } from "bun:test"

import type { FileMode } from "#session/steps/file/mode.ts"
import {
  formatMode,
  GROUP_EXECUTABLE_MODE,
  GROUP_FILE_MODE,
  PRIVATE_EXECUTABLE_MODE,
  PRIVATE_FILE_MODE,
  PUBLIC_EXECUTABLE_MODE,
  PUBLIC_FILE_MODE,
  toModeBits,
} from "#session/steps/file/mode.ts"

describe("toModeBits", () => {
  it("should read an octal mode, with or without a leading digit for the special bits", () => {
    expect([toModeBits("644"), toModeBits("0644"), toModeBits("4755")]).toStrictEqual([0o644, 0o644, 0o4755])
  })

  it("should read a symbolic mode", () => {
    expect([toModeBits("rw-r--r--"), toModeBits("rwxr-x---"), toModeBits("---------")]).toStrictEqual([0o644, 0o750, 0])
  })

  it("should read s, S, t, and T as the special bits, with execute only for the lowercase ones", () => {
    expect([toModeBits("rwsr-sr-t"), toModeBits("rwSr--r-T")]).toStrictEqual([0o7755, 0o5644])
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

    expect(modes.map((mode) => toModeBits(mode))).toStrictEqual([0o644, 0o640, 0o600, 0o755, 0o750, 0o700])
  })
})

describe("formatMode", () => {
  it("should show the symbolic mode with the octal after it, padded to three digits", () => {
    expect([formatMode(0o644), formatMode(0o44)]).toStrictEqual(["rw-r--r-- (644)", "---r--r-- (044)"])
  })

  it("should show the special bits in both notations", () => {
    expect([formatMode(0o7755), formatMode(0o5644)]).toStrictEqual(["rwsr-sr-t (7755)", "rwSr--r-T (5644)"])
  })
})
