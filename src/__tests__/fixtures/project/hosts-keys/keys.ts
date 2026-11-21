import { host } from "tsinfra"

export default host({ name: "keys", target: "@local" }, async (h) => {
  await h.read("true", { env: { URL: "http://localhost" } })
  await h.ensure("Configure the app", {
    want: { env: { TZ: "UTC" }, groups: new Set(["docker"]) },
    check: async ({ read }) => ({ env: { TZ: await read("echo GMT") }, groups: new Set(["wheel"]) }),
    fix: "true",
  })
})
