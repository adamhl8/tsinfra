import process from "node:process"

import "@adamhl8/configs/test/preload"

// Turn colors off before any test imports picocolors, because it decides once, and a terminal would turn them on.
process.env["NO_COLOR"] = "1"
// Clear `FORCE_COLOR`, because `bask` sets it in a terminal, and `getErrorColors` prefers it over `NO_COLOR`.
process.env["FORCE_COLOR"] = ""
