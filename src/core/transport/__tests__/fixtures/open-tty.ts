import { isErr, messageChain } from "ts-explicit-errors"

import { runLocal } from "#core/transport/local.ts"

// Print whether a local command could open the terminal this process runs in.
const output = await runLocal("if (exec 3</dev/tty) 2>/dev/null; then echo opened; else echo no terminal; fi")
console.log(isErr(output) ? messageChain(output) : output.stdout.trim())
