import { describe, expect, it, spyOn } from "bun:test"
import process from "node:process"

import { formatMessage } from "@optique/core/message"
import { err } from "ts-explicit-errors"

import { getErrorColors, printTsinfraError, toErrorMessage } from "#report/errors.ts"

describe("toErrorMessage", () => {
  it("should keep each line of the error's message chain", () => {
    const error = err("failed to load hosts:\nfailed to load host 'a' -> boom", undefined)

    expect(formatMessage(toErrorMessage(error))).toBe("failed to load hosts:\nfailed to load host 'a' -> boom")
  })
})

describe("getErrorColors", () => {
  it.each([
    { description: "turn colors on for FORCE_COLOR", env: { FORCE_COLOR: "1" }, expected: { colors: true } },
    { description: "turn colors off for NO_COLOR", env: { NO_COLOR: "1" }, expected: { colors: false } },
    {
      description: "prefer FORCE_COLOR over NO_COLOR",
      env: { FORCE_COLOR: "1", NO_COLOR: "1" },
      expected: { colors: true },
    },
    { description: "leave colors out otherwise", env: {}, expected: {} },
  ])("should $description", (testCase) => {
    const { env, expected } = testCase

    expect(getErrorColors(env)).toStrictEqual(expected)
  })
})

describe("printTsinfraError", () => {
  it("should print the error to stderr with its label", () => {
    const write = spyOn(process.stderr, "write").mockReturnValue(true)

    printTsinfraError(err("boom", undefined))
    const printed = write.mock.calls[0]?.[0]
    write.mockRestore()

    expect(printed).toBe("Error: boom\n")
  })
})
