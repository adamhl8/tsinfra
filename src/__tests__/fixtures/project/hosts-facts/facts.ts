import { host } from "tsinfra"

export default host({ name: "facts", target: "@local" }, async (h) => {
  await h.read("true")
  h.log.info(`${h.facts.platform} ${h.facts.arch}`)
})
