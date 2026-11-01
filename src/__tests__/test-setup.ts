import process from "node:process"

import "@adamhl8/configs/test/preload"
import "@adamhl8/configs/test/subprocess-coverage"

// Turn colors off before any test imports picocolors, because it decides once, and a terminal would turn them on.
process.env["NO_COLOR"] = "1"
