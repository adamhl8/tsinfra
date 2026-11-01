import { describe, expect, it } from "bun:test"

import { formatMessage } from "@optique/core/message"
import { err } from "ts-explicit-errors"

import { toErrorMessage } from "#report/errors.ts"

describe("toErrorMessage", () => {
  it("should keep each line of the error's message chain", () => {
    const error = err("failed to load hosts:\nfailed to load host 'a' -> boom", undefined)

    expect(formatMessage(toErrorMessage(error))).toBe("failed to load hosts:\nfailed to load host 'a' -> boom")
  })
})
