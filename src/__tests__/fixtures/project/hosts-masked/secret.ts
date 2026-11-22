import { host } from "tsinfra"

const TOKEN = "s3cret-token"
const secretEnv = { TOKEN }

export default host({ name: "secret", target: "@local" }, async (h) => {
  await h.read('printf "token=%s" "$TOKEN"', { secretEnv })
  h.log.warn(`the token is ${TOKEN}`)
  await h.ensure(`Check ${TOKEN}`, { want: true, check: "true", fix: "true" })
  await h.ensure("Set the tokens", {
    want: [TOKEN, "new"],
    check: String.raw`printf '%s\nold-%s\n' "$TOKEN" "$TOKEN"`,
    fix: 'echo "rejected $TOKEN" >&2; exit 1',
    secretEnv,
  })
})
