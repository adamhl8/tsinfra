import process from "node:process"

import { isErr, messageChain } from "ts-explicit-errors"

import { closeConnections, getTransport } from "#transport/transport.ts"

// Run one command on the target, close its connection, and print the output or the error's message chain.
// Name the target twice, so the close shows it runs once per target.
const [target = "", cmd = ""] = process.argv.slice(2)

const output = await getTransport(target)(cmd)
await closeConnections([target, target])

console.log(JSON.stringify(isErr(output) ? messageChain(output) : output))
