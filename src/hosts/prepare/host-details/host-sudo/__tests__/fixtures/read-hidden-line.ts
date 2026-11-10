import process from "node:process"

import { readHiddenLine } from "#hosts/prepare/host-details/host-sudo/read-hidden-line.ts"

// Print what came back, and whether stdin was left as it was found.
const line = await readHiddenLine("password: ")
const { isRaw } = process.stdin
console.log(JSON.stringify({ line, isRaw, keypressListeners: process.stdin.listenerCount("keypress") }))
