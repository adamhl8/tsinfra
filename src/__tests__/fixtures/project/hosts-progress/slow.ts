import { host } from "tsinfra"

// Give the read a long, multi-line command, so the progress line has to cut it to one line that fits.
export default host({ name: "slow", target: "@local" }, async (h) => {
  await h.read(`sleep 0.5 # ${"x".repeat(100)}\ntrue`)
})
