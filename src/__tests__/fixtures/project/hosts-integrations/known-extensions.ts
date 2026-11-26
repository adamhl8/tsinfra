import { host } from "tsinfra"
import { readKnownExtensions } from "tsinfra/integrations/macos/file-handlers"

export default host({ name: "known-extensions", target: "@local" }, async (h) => {
  const extensions = await readKnownExtensions(h, ["pdf", "nosuchextension"])
  h.log.info(`known: ${extensions.join(", ")}`)
})
