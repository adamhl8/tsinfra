import { describe, expect, it } from "bun:test"

import type { FileMode } from "#session/handlers/file/mode.ts"
import {
  GROUP_EXECUTABLE_MODE,
  GROUP_FILE_MODE,
  PRIVATE_EXECUTABLE_MODE,
  PRIVATE_FILE_MODE,
  PUBLIC_EXECUTABLE_MODE,
  PUBLIC_FILE_MODE,
  toModeBits,
  toOctalMode,
  toSymbolicMode,
} from "#session/handlers/file/mode.ts"

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

describe("toOctalMode", () => {
  it("should keep three digits, and a fourth for the special bits", () => {
    expect([toOctalMode(0o644), toOctalMode(0o44), toOctalMode(0o4755)]).toStrictEqual(["644", "044", "4755"])
  })
})

describe("toSymbolicMode", () => {
  it("should return the mode the way ls prints it", () => {
    expect([toSymbolicMode(0o644), toSymbolicMode(0o44)]).toStrictEqual(["rw-r--r--", "---r--r--"])
  })

  it("should show the special bits, in capitals when the execute bit isn't set", () => {
    expect([toSymbolicMode(0o7755), toSymbolicMode(0o5644)]).toStrictEqual(["rwsr-sr-t", "rwSr--r-T"])
  })
})
