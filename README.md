# tsinfra

An agentless infrastructure as code tool for TypeScript.

Write one script per machine. A script reads top to bottom and is made of idempotent steps. `tsinfra plan` shows what has drifted on each machine, and `tsinfra apply` fixes only what needs fixing.

- Nothing to install on your machines besides `sh` and `sshd`
- Plain TypeScript: loops, conditionals, template literals, `fetch`, and your own helper functions
- `plan` reads every step's state on the machine and changes nothing
- Every fix is checked again afterward, so a fix that doesn't work fails loudly
- No inventory file, no state file to keep in sync, and no DSL

> [!WARNING]
> tsinfra is in early development. Expect breaking changes.

---

<!-- toc -->

- [Installation](#installation)
- [Usage](#usage)
- [Hosts](#hosts)
  - [SSH](#ssh)
  - [sudo](#sudo)
- [Steps](#steps)
  - [`ensure`](#ensure)
  - [`file`](#file)
  - [`link`](#link)
  - [`dir`](#dir)
  - [`run`](#run)
  - [`read` and `inspect`](#read-and-inspect)
- [Commands](#commands)
  - [Values and secrets](#values-and-secrets)
- [Needs](#needs)
- [Failures](#failures)
- [Output](#output)
- [Integrations](#integrations)
- [Facts](#facts)
- [CLI Reference](#cli-reference)
- [Design](#design)
- [License](#license)

<!-- tocstop -->

## Installation

tsinfra requires [Bun](https://bun.sh). Bun runs your host scripts as TypeScript directly, with no build step.

```sh
bun add --dev tsinfra     # the version your host scripts run on
bun add --global tsinfra  # optional, for a plain `tsinfra`
```

- Install it in the repo that holds your host scripts, because the scripts import `"tsinfra"`.
- The global copy only starts the project's copy, so host scripts run on the version in your lockfile. Without it, run `bunx tsinfra`.

> [!TIP]
> Without a global install, direnv's `layout node` or mise's `_.path` put the project's `node_modules/.bin` on the `PATH` inside the repo, for the same plain `tsinfra`.

## Usage

Create a `hosts/` directory with one `.ts` file per machine:

```ts
// hosts/sonarr.ts
import { host } from "tsinfra"

import { sonarrUnit } from "../files/sonarr-unit.ts"

export default host({ name: "sonarr", target: "sonarr.lan", sudo: true }, async (h) => {
  await h.ensure("Install Caddy", {
    want: true,
    check: "dpkg -s caddy",
    fix: "sudo apt-get install -y caddy",
  })

  const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
  await h.run("Reload systemd", "sudo systemctl daemon-reload", { after: [unit] })

  await h.ensure("Start Sonarr", {
    want: "active",
    check: "systemctl is-active sonarr",
    fix: "sudo systemctl enable --now sonarr",
  })
})
```

See what would change:

```sh
tsinfra plan          # every host in ./hosts
tsinfra plan sonarr   # just this one
```

```
sonarr
  ~ change: (file) /etc/systemd/system/sonarr.service
      ───────────────────────────────
      5  ExecStart=/opt/Sonarr/Sonarr
        -Restart=always
      6 +Restart=on-failure
      7
      ───────────────────────────────
  > triggered: (run) Reload systemd

Steps after a change were checked without that change, so apply may differ.

sonarr   2 changes
```

Then make the changes:

```sh
tsinfra apply sonarr
```

- `plan` exits 2 when anything drifted, so a drift check in CI or a cron job is one line.
- `apply` doesn't ask for confirmation. Run `plan` first.

## Hosts

```ts
host(config: HostConfig, fn: (h: Host) => Promise<void>)

interface HostConfig {
  name: string
  target: string
  sudo?: boolean | { password: string }
}
```

Each file in `hosts/` default exports a `host()`.

- `name`: the host's name, which the report shows and the command line picks it by. It must be unique across host scripts, and has letters, digits, `.`, `_`, and `-`, starting with a letter or a digit.
- `target`: where the commands run
  - `"@local"`: the machine tsinfra runs on
  - Anything else goes to `ssh` as written, like `"sonarr.lan"` or `"alice@incus.lan"`
- `sudo`: declares that the script uses sudo (see [sudo](#sudo))
- `fn`: the host function. It's given `h`, which has every [step](#steps).

tsinfra loads every host script on each run before it picks the hosts to run, so a script's top level runs even when its host isn't picked. Keep it to quick definitions. Something that prompts or takes a while, like reading a secret from a password manager, goes in the host function or a step.

Shared setup is an ordinary function that takes `h`, imported from anywhere outside `hosts/`:

```ts
// lib/base.ts
import type { Host } from "tsinfra"

export const base = async (h: Host) => {
  await h.ensure("Install fish", { want: true, check: "command -v fish", fix: "sudo apt-get install -y fish" })
}
```

```ts
// hosts/sonarr.ts
export default host({ name: "sonarr", target: "sonarr.lan" }, async (h) => {
  await base(h)
  // the rest of the host's steps...
})
```

---

### SSH

tsinfra runs your own `ssh`, so your `~/.ssh/config` applies: users, ports, keys, jump hosts, and so on.

- ssh must log in without a prompt, with a key or an agent. tsinfra runs it with `BatchMode=yes`.
- A new host's key is accepted the first time (`accept-new`), unless your config sets `StrictHostKeyChecking`. A changed key always fails.
- Each host gets one connection for the whole run, which is closed when the run ends.

---

### sudo

Commands say `sudo` themselves, only where they need it, like `fix: "sudo systemctl enable --now sonarr"`. `file` and `link` take `sudo: true` instead, because tsinfra writes their commands.

A host whose script uses sudo declares it on `host()`:

```ts
export default host({ name: "macbook", target: "@local", sudo: true }, fn)
export default host({ name: "incus", target: "incus.lan", sudo: { password: incusSudoPassword } }, fn)
```

- `sudo: true`: before any script runs, tsinfra checks that sudo works. If it needs a password, tsinfra asks for it once, and every command on that host uses it.
- `sudo: { password }`: uses the given password and never prompts. Use it only when the run can't prompt, like in CI.

> [!TIP]
> Declare `sudo: true` even when sudo is passwordless. A broken sudo then fails before any host changes anything, instead of partway through a script.

At the prompt, Ctrl-D skips that host, and Ctrl-C cancels the run. With no terminal, a host that needs a password fails.

## Steps

Every step is a method on `h`. Steps run one at a time, in the order you call them.

| When the code...                       | Use                                                                   |
| -------------------------------------- | --------------------------------------------------------------------- |
| changes state that can be checked      | [`ensure`](#ensure), or [`file`](#file) and [`link`](#link) for files |
| follows up on a change, or always runs | [`run`](#run) with `after`                                            |
| picks which steps apply                | [`read` or `inspect`](#read-and-inspect), and an `if`                 |

Plain control flow is fine, except for deciding whether a change is needed. That belongs in a step's `check`, where `plan` can see it:

```ts
// don't: plan can't verify this, and it never counts as drift
const docker = await h.inspect("command -v docker")
if (docker.exitCode !== 0) await h.run("Install docker", installDocker, { after: "always" })

// do
await h.ensure("Install docker", { want: true, check: "command -v docker", fix: installDocker })
```

`ensure`, `file`, `link`, `dir`, and `run` return a `ChangeStepResult`, which you pass to a later step's `after` or `needs`:

```ts
interface ChangeStepResult {
  name: string
  kind: "file" | "link" | "dir" | "ensure" | "run"
  changed: boolean // in plan, this means "would change"
}
```

> [!TIP]
> Name a step like a function, starting with a verb ("Install Caddy"), or as the state it ensures ("Caddy is installed"). Each change step needs its own name in a host script, so a step in a loop puts the item in its name.

---

### `ensure`

```ts
h.ensure(name: string, options: EnsureOptions): Promise<ChangeStepResult>
```

Compares `want` with what `check` answers. When they differ, `apply` runs `fix`, then runs `check` again to make sure it worked. `plan` only runs `check`.

- `want`: the answer when the state is already right
  - `true`: `check` exits 0 (or the function returns `true`)
  - `false`: `check` exits non-zero (or the function returns `false`)
  - A string: compared with `check`'s stdout (or the function's return value). Trailing newlines are ignored.
  - A list of strings: compared in order with `check`'s lines, blank ones left out (or the function's array), so a reorder or a duplicate counts. `[]` means nothing is left to do.
  - A `Set` of strings: compared the same way, but as a set, so order and duplicates don't count. A check function returns a `Set`.
  - A record of string keys: compared with the function's object by key, each value exactly, so `8080` never matches `"8080"`. A value is a string, a number, a boolean, `null`, or a nested list, set, or record, each compared the way its type is at the top level. Its type can come from an `interface`. It needs a check function.
- `check`: a command, or an async function given `{ read, inspect }` that returns the answer
- `fix`: a command, or an async function given `{ exec, inspect }`. The function also gets `want` and what `check` found: `{ want }` for a boolean, `{ got, want }` for a string or a list, `{ want, missing, extra }` for a set, and `{ got, want, unmet, extra, nestedExtra, differing }` for a record, where `unmet` is `want` pruned to what the host doesn't match at any depth, `extra` and `nestedExtra` are what the host has that `want` doesn't, and `differing` marks each key that differs, for a fix that rewrites whole values. It only runs in `apply`.
- `verify` (default: `true`): run `check` again after `fix`, and fail if the state still differs
- `env`, `secretEnv`: see [Values and secrets](#values-and-secrets)
- `needs`: see [Needs](#needs)

```ts
await h.ensure("Install Caddy", { want: true, check: "dpkg -s caddy", fix: "sudo apt-get install -y caddy" })
await h.ensure("Remove the old user", { want: false, check: "id olduser", fix: "sudo userdel olduser" })

await h.ensure("Start Sonarr", {
  want: "active",
  check: "systemctl is-active sonarr",
  fix: "sudo systemctl enable --now sonarr",
})
```

How a change shows depends on `want`:

- A boolean shows only the step's name.
- A string shows `got:` and `want:` rows. For a multi-line value, the rows hold only the lines that differ.
- A list shows a diff, with `-` for an item only the host has and `+` for one only `want` has.
- A set shows `missing:` and `extra:` rows.
- A record shows a row per key that differs, with a nested record's, list's, or set's differences under its key.

**A set** is for a set of things, like packages:

```ts
await h.ensure("Install packages", {
  want: new Set(["fd-find", "jq", "ripgrep"]),
  check: "dpkg-query -W -f='${Package}\\n' fd-find jq ripgrep 2>/dev/null",
  fix: async ({ exec }, { missing }) => {
    await exec(`sudo apt-get install -y ${missing.join(" ")}`)
  },
})
```

```
  ~ change: (ensure) Install packages
      missing: ripgrep
```

- It's compared as a set, so order and duplicates don't count, and neither side needs sorting.
- A command `check`'s output is split into lines, and blank lines are left out.
- `missing` is what `want` has that the check didn't find. `extra` is what the check found that `want` doesn't have.

**A list** is for items in order, like search domains:

```ts
await h.ensure("Set the search domains", {
  want: ["lan", "home.arpa"],
  check: async ({ read }) => (await read("resolvectl domain eth0")).split(" ").slice(1),
  fix: "sudo resolvectl domain eth0 lan home.arpa",
})

await h.ensure("Upgrade brew packages", { want: [], check: "brew outdated --quiet", fix: "brew upgrade" })
```

```
  ~ change: (ensure) Set the search domains
      ──────────
      -home.arpa
       lan
      +home.arpa
      ──────────
  ~ change: (ensure) Upgrade brew packages
      found: node
             python@3.13
```

- A reorder shows as the item leaving one place and arriving in another.
- The fix gets `{ got, want }`, the host's list and the wanted one, because `missing` and `extra` can't describe a reorder.
- `want: []` is for a check that lists what's left to do, like outdated packages, so everything it lists shows on a `found:` row.

**A record** of string keys is for names with a value each, like packages on a version each, or for structured config, like a container's `env`, `labels`, and `ports`:

```ts
// The newest version each package's range allows, read from the registry.
const wanted: Record<string, string> = { pnpm: "11.2.0", turbo: "2.5.4", zx: "8.8.1" }

await h.ensure("Sync bun global packages", {
  want: wanted,
  check: async ({ read }) => toVersions(await read("bun pm ls -g")), // { name: version } for each installed package
  fix: async ({ exec }, { extra, unmet }) => {
    const installs = Object.entries(unmet).map(([name, version]) => `${name}@${version}`)
    if (installs.length > 0) await exec(`bun add -g ${installs.join(" ")}`)
    if (Object.keys(extra).length > 0) await exec(`bun remove -g ${Object.keys(extra).join(" ")}`)
  },
})
```

```
  ~ change: (ensure) Sync bun global packages
      pnpm:       11.1.0 -> 11.2.0
      zx:         (none) -> 8.8.1
      typescript: 5.9.2 -> (none)
```

- It needs a check function, because a command's output has no keys.
- Each key's value is compared exactly, and key order doesn't count.
- A row goes from the host's value to the wanted one. `(none)` marks a side that doesn't have the key.
- `missing` maps a key to its wanted value, `extra` maps a key to its current value, and `changed` maps a key to `{ got, want }`.

> [!TIP]
> Make `want` the state you want, and have the check report the host's state in the same shape, without comparing. Keep a spec like `"latest"` as your helper's input, and resolve it to a version for `want` before the step. See [the state you want, or what's left to do](./docs/recipes.md#the-state-you-want-or-whats-left-to-do).

Use a check function to work out the answer in TypeScript:

```ts
const latest = await fetchLatestCaddyVersion() // runs on your machine

await h.ensure("Update Caddy", {
  want: latest,
  check: async ({ read }) => (await read("caddy version")).split(" ")[0] ?? "",
  fix: async ({ exec }) => {
    await exec(`curl -fsSLo /tmp/caddy.deb https://example.com/caddy_${latest}.deb`)
    await exec("sudo dpkg -i /tmp/caddy.deb")
  },
})
```

- `check` also runs in `plan`, so it must not change anything your script manages.
- A command `check` never fails on a non-zero exit, because that's an answer. A `read` inside a check function does fail on one, so use `inspect` when a non-zero exit is an answer.
- A command check that exits non-zero but still matches `want` fails the step, so a broken check can't look converged.
- `fix` re-runs every command each time `check` fails. If one command's effect can be in place while `check` still fails, give that effect its own step.

> [!TIP]
> Set `verify: false` only for a fix whose effect nothing in the run can show, like one that needs a reboot. The next run's `check` confirms it.

---

### `file`

```ts
h.file(path: string, content: string | Uint8Array | Blob, options?: FileOptions): Promise<ChangeStepResult>
```

Writes `content` to `path`, when it differs. `plan` shows a diff of the content and any attribute that would change.

- `path`: absolute, starting with `/` or `~/`. `~/` is the SSH user's home, even with `sudo`.
- `content`: a string, bytes, or a `Blob` like `Bun.file(...)` for a file on your machine

Options:

- `mode`: `"644"`, `"rw-r--r--"`, or one of the [mode constants](#modes). A typo like `"648"` is a type error.
- `user`, `group`: a name or an id
- `sudo` (default: `false`): read, diff, and write the file as root
- `secret` (default: `false`): never fetch or show the old content. New files get mode `600`.
- `overwrite` (default: `true`): `false` writes the file only when it's missing, and leaves an existing one alone
- `validate`: a function given the temp file's path, which returns a command that checks the new content before it replaces the file
- `needs`: see [Needs](#needs)

```ts
const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
await h.file("/etc/caddy/Caddyfile", Bun.file(path.join(FILES, "Caddyfile")), { sudo: true })
await h.file("~/.config/app/token", token, { secret: true, mode: "600" })

await h.file("/etc/ssh/sshd_config", sshdConfig, { sudo: true, validate: (tempPath) => `sshd -t -f ${tempPath}` })
```

- `mode`, `user`, and `group` are only managed when given. Otherwise an existing file keeps its own, and a new file gets `644` and the user that wrote it.
- The write is atomic: the content goes to a temp file next to `path`, which is renamed into place.
- Missing parent directories are created.
- `path` must be a regular file or missing. A symlink, a directory, or anything else fails the step.
- Content over 10 MB fails the step.
- A `mode`, `user`, or `group` that an earlier step set differently on the same path fails the step, including a link's `targetAttributes`, because each apply would undo the other.

> [!TIP]
> `Bun.file("files/x")` resolves against the directory tsinfra runs from. Build paths from your script's own location instead:
>
> `ts // lib/paths.ts export const FILES = path.resolve(import.meta.dir, "../files") `

#### Modes

| Constant                  | Mode        | Octal | For                                        |
| ------------------------- | ----------- | ----- | ------------------------------------------ |
| `PUBLIC_FILE_MODE`        | `rw-r--r--` | `644` | Most config files                          |
| `GROUP_FILE_MODE`         | `rw-r-----` | `640` | A secret a service reads through its group |
| `PRIVATE_FILE_MODE`       | `rw-------` | `600` | Keys, tokens, and other secrets            |
| `PUBLIC_EXECUTABLE_MODE`  | `rwxr-xr-x` | `755` | Scripts and binaries                       |
| `GROUP_EXECUTABLE_MODE`   | `rwxr-x---` | `750` | A script only a group may run              |
| `PRIVATE_EXECUTABLE_MODE` | `rwx------` | `700` | A script only its owner may run            |
| `PUBLIC_DIRECTORY_MODE`   | `rwxr-xr-x` | `755` | Most directories                           |
| `GROUP_DIRECTORY_MODE`    | `rwxr-x---` | `750` | A directory only a group may enter         |
| `PRIVATE_DIRECTORY_MODE`  | `rwx------` | `700` | A directory only its owner may enter       |

---

### `link`

```ts
h.link(path: string, target: string, options?: LinkOptions): Promise<ChangeStepResult>
```

Makes `path` a symlink to `target`. Both are absolute, starting with `/` or `~/`, and both are on the host.

- `user`, `group`: a name or an id, for the link itself
- `force` (default: `false`): replace a regular file or an empty directory at `path`
- `targetAttributes`: the `mode`, `user`, and `group` of the file the link points to, like `file`'s. Left out, the target keeps its own.
- `sudo` (default: `false`): read and make the link, and set its target's attributes, as root
- `needs`: see [Needs](#needs)

```ts
// on "@local": link a dotfile into your repo
await h.link("~/.config/fish/config.fish", path.join(DOTFILES, "fish/config.fish"))

// ssh refuses a config others can write, so the repo's copy gets 600
await h.link("~/.ssh/config", path.join(DOTFILES, "ssh/config"), { targetAttributes: { mode: PRIVATE_FILE_MODE } })
```

- An existing symlink is always pointed at `target`.
- A symlink has no mode of its own, so `targetAttributes` is how a linked dotfile gets one. It follows a target that's itself a link to the file at the end, and `plan` shows its rows like `target mode: rw-r--r-- (644) -> rw------- (600)`.
- A regular file at `path` fails the step unless `force` is set, and there's no backup. A directory with anything in it always fails.
- A missing `target` is allowed, with a warning in the output, because a later step might create it. Its `targetAttributes` are set once it exists.

---

### `dir`

```ts
h.dir(path: string, options?: DirOptions): Promise<ChangeStepResult>
```

Makes sure `path` is a directory. It's absolute, starting with `/` or `~/`, and on the host.

- `mode`: see [Modes](#modes). Left out, an existing directory keeps its own.
- `user`, `group`: a name or an id. Left out, an existing directory keeps its own.
- `sudo` (default: `false`): read and make the directory as root
- `needs`: see [Needs](#needs)

```ts
const data = await h.dir("/srv/sonarr", { mode: GROUP_DIRECTORY_MODE, user: "sonarr", group: "sonarr", sudo: true })
await h.file("/srv/sonarr/config.xml", sonarrConfig, { needs: [data], user: "sonarr", sudo: true })
```

- Missing parents are made too, with the default mode and owner.
- A symlink, a regular file, or anything else at `path` fails the step.
- A `mode`, `user`, or `group` that an earlier step set differently on the same path fails the step, like `file`'s.
- `plan` shows a row for each attribute that differs, like `mode: rwx------ (700) -> rwxr-x--- (750)`.

---

### `run`

```ts
h.run(name: string, cmd: string | ((tools: ChangeTools) => Promise<void>), options: RunOptions): Promise<ChangeStepResult>
```

Runs a command with no check, for work that something in the run triggers.

- `after`: when to run
  - An array of change step results: run when any of them changed, or when an apply that didn't finish left the run to do
  - `"always"`: run on every `apply`
- `env`, `secretEnv`: see [Values and secrets](#values-and-secrets)

```ts
const unit = await h.file("/etc/systemd/system/sonarr.service", sonarrUnit, { sudo: true })
await h.run("Reload systemd", "sudo systemctl daemon-reload", { after: [unit] })

await h.run("Prune docker", "docker system prune -f", { after: "always" })

await h.run(
  "Update the stack",
  async ({ exec }) => {
    await exec("docker compose pull")
    await exec("docker compose up -d")
  },
  { after: [compose] },
)
```

- `plan` never runs it, and shows it as `> triggered` when it would run.
- A run with `after: "always"`, or one that follows only those, shows as `> always`. `plan` shows it only with `-v`, because it runs on every `apply`.
- A run counts as drift only when an apply that didn't finish left it to do.
- A run can follow another run, like `after: [reload]`.

> [!NOTE]
> If a run fails, or the host fails between a change and its run, the next `apply` still triggers the run. tsinfra keeps the changes an apply made on the host until the host finishes an `apply` cleanly, and shows a step whose change is still open as `^ resume`.

Anything that can be checked should be an `ensure`. A run function that tests the host before acting works, but `plan` can't see what it decides.

---

### `read` and `inspect`

```ts
h.read(cmd: string, options?: ReadOptions): Promise<string>
h.inspect(cmd: string, options?: InspectOptions): Promise<{ stdout: string; stderr: string; exitCode: number }>
```

Run a command in both `plan` and `apply`, and return what it printed, for facts your script branches on that [`h.facts`](#facts) doesn't hold.

- `read` returns stdout, and fails on a non-zero exit.
- `inspect` returns stdout, stderr, and the exit code, and never fails on a non-zero exit.
- Options: `env`, `secretEnv`, and `maskOutput` (see [Values and secrets](#values-and-secrets))

```ts
const cpuCount = Number(await h.read("nproc"))

const container = await h.inspect("systemd-detect-virt --container")
if (container.exitCode !== 0) await tuneKernel(h)
```

- Read a fact once at the top level, and use it inside a step through the closure.
- Only branch on facts no step changes, like whether the host is a container. For state a step changes, use `ensure`.
- They also run in `plan`, so they must not change anything your script manages.

## Commands

Every command string is run by `sh` on the host. Use one command per string, and do the logic in TypeScript.

For more than one command, pass a function. A check function gets `read` and `inspect`. A fix or run function gets `exec` and `inspect`.

- `read(cmd)` / `exec(cmd)`: returns stdout, and fails on a non-zero exit, which stops the function there
- `inspect(cmd)`: returns `{ stdout, stderr, exitCode }`, and never fails on a non-zero exit

```ts
fix: async ({ exec }) => {
  const id = await exec(`docker create ${image}`)
  await exec(`docker cp ./seed ${id}:/data`)
  await exec(`docker start ${id}`)
}
```

- Output is trimmed of leading and trailing whitespace.
- Write `sudo` inside the command, only where it's needed.
- Inside a step's function, use only the tools it's given. Calling `h` there fails the host, so steps never nest.
- Commands inside one function can run at once, with `Promise.all`. Steps can't.

> [!TIP]
> Let commands print. Don't add `-q` or `>/dev/null` just because nothing reads the output. The output is hidden by default, and you'll want it in `-vvv` and when something fails.

---

### Values and secrets

Pass a value that could hold shell syntax as an environment variable, not in the command's text. `env` and `secretEnv` take an object of variables, and the command uses them as `"$NAME"`:

```ts
await h.read('curl -fsSL -H "Authorization: Bearer $TOKEN" "$URL"', {
  secretEnv: { TOKEN: token },
  env: { URL: url },
})
```

- Any value works as-is, with spaces, quotes, or `$` in it, because the shell reads it as a value, never as code.
- Values must be strings, like `String(port)`. They're literal, so `"$PATH"` in a value isn't expanded.
- The variables reach every command in the step, including each tool call in its functions.
- A tool call can take its own `env` and `secretEnv`, for a value only its function has, like a secret a fix fetches. They're added to the step's for that one command, and win for a name both set.
- They're exported, so a tool that reads its credentials from the environment gets them, like `h.read("gh api user", { secretEnv: { GH_TOKEN: token } })`.
- A program run under `sudo` doesn't see exported variables, because sudo resets the environment. `sudo tee "$FILE"` still works, because the shell expands `"$FILE"` first.

> [!IMPORTANT]
> A value put into a command's text is read as shell code. That's fine for a value with a known, safe shape, like a package name or a version. Pass anything else through `env`, like a path with spaces, a message, a file's contents, or user input, so the shell reads it as a value. In the text, a space would break the command, and a `;` or `$(...)` would run part of it. Pass a secret through `secretEnv`, so it's masked.

`secretEnv` values show as `[MASKED]` everywhere tsinfra prints or records them, from that step or tool call on: in the options, and in the output and errors of every later command on the host. Your script still gets the real values.

`maskOutput: true` masks a command's output the same way, for a secret read from the host. `read`, `inspect`, and the tools all take it:

```ts
const token = await h.read("cat /etc/app/token", { maskOutput: true })
```

To check a secret, compare it on the host, so it never shows as `got:` and `want:`:

```ts
await h.ensure("Set the API token", {
  want: true,
  check: 'grep -qxF "$TOKEN" ~/.config/app/token',
  fix: 'printf "%s\\n" "$TOKEN" > ~/.config/app/token',
  secretEnv: { TOKEN: token },
})
```

## Needs

`plan` reads each step's state from the host as it is now. A step after a change reads the old state, which can give the wrong answer, or fail. `needs` names the earlier steps a step's state depends on:

```ts
const brew = await h.ensure("Install brew packages", { want: true, check: "brew bundle check", fix: "brew bundle" })

await h.ensure("Install fish plugins", {
  needs: [brew],
  want: true,
  check: async ({ read }) => (await read("fish -c 'fisher list'")).includes("jorgebucaran/fisher"),
  fix: "fish -c 'fisher update'",
})
```

On a fresh machine, fish isn't installed yet, so `plan` shows the step as waiting instead of failing:

```
macbook
  ~ change: (ensure) Install brew packages
  ? waiting: (ensure) Install fish plugins   needs 'Install brew packages'
```

- `ensure`, `file`, `link`, and `dir` take `needs`, and accept results from `ensure`, `file`, `link`, and `dir`.
- In `plan`, a step waits when any step it needs would change or is waiting.
- In `apply`, `needs` does nothing, because the needed steps already ran.
- Only add `needs` when a step's state really depends on the earlier change. When any step would change, `plan` already reminds you that later steps were checked without it.

## Failures

You never check a step's result for errors. When a step fails, the host is marked failed and the call throws, which stops the script there. The other hosts still run.

- Don't catch around calls on `h`. A failed host stays failed, and every later call on `h` throws straight away.
- When a non-zero exit is an answer, use `inspect`:

```ts
const { exitCode } = await h.inspect("curl -f https://example.com/a")
if (exitCode !== 0) await h.read("curl -f https://example.com/b")
```

An error thrown anywhere else in the host function, like a bug in your script, fails the host the same way.

## Output

Each host prints one block when it finishes, then a summary line per host follows.

By default, a block lists only the steps that changed, would change, are waiting, or failed:

| Status        | Meaning                                                           |
| ------------- | ----------------------------------------------------------------- |
| `~ change`    | The host's state differed, so the fix ran (would run in `plan`)   |
| `> triggered` | A run's `after` fired                                             |
| `> always`    | A run on every pass, like `after: "always"` (`-v` in `plan`)      |
| `? waiting`   | A step it needs would change                                      |
| `^ resume`    | Already right, but an earlier apply that changed it didn't finish |
| `! failed`    | The step failed. Its error is under it.                           |
| `= unchanged` | Already right (`-v`)                                              |
| `· observed`  | A `read` or `inspect` (`-v`)                                      |

Each `-v` shows more:

- `-v`: every step, and every long diff and differing line in full
- `-vv`: the options a step set, like `options: sudo`, every command each step ran, and a diff that was slow to compute
- `-vvv`: option values (secrets as `[MASKED]`), and each command's exit code, stdout, and stderr

## Integrations

Integrations set up one specific program, service, or piece of config with ordinary steps. Each is its own import:

```ts
import { fileHandlers } from "tsinfra/integrations/macos/file-handlers"

await fileHandlers(h, { "/System/Applications/Preview.app": ["pdf"] })
```

| Import                                     | Sets up                                      |
| ------------------------------------------ | -------------------------------------------- |
| `tsinfra/integrations/macos/file-handlers` | Which app opens each file extension on a Mac |

See [Integrations](./docs/integrations.md) for each one's options and caveats.

## Facts

`h.facts` holds what scripts most often branch on, read before the script runs, with the names normalized to Go's, the way most release downloads name them:

```ts
h.facts.home // "/home/alice", the SSH user's home
h.facts.platform // "darwin" or "linux"
h.facts.arch // "amd64" or "arm64"
h.facts.osRelease // { id: "debian", versionCodename: "trixie", ... }, or undefined on macOS
```

A value tsinfra has no name for, like `armv7l`, passes through as the host printed it, with a warning in the report. See [Facts](./docs/steps.md#facts) for what each reads.

## CLI Reference

```
tsinfra plan [options] [HOST]...
tsinfra apply [options] [HOST]...
tsinfra --help
tsinfra --version
```

- `plan`: show what would change on each host
- `apply`: make the changes on each host
- `HOST`: a host's `name` (default: every host)

Options:

- `--hosts-dir DIR`: the directory of host scripts (default: `hosts`)
- `-v`, `--verbose`: show more of each host's output. Use `-vv` and `-vvv` to show even more.
- `--help`: show help, for tsinfra or for a command (`tsinfra plan --help`)
- `--version`: show the version

Hosts run one at a time, in order of their names.

Exit codes:

|         | `0`      | `1`             | `2`      |
| ------- | -------- | --------------- | -------- |
| `plan`  | no drift | any host failed | drift    |
| `apply` | success  | any host failed | not used |

- A failed host wins over drift.
- A `run` never counts as drift.

## Design

The [design docs](./docs/README.md) cover how tsinfra works in depth. [Recipes](./docs/recipes.md) has patterns for common jobs, and the [roadmap](./docs/roadmap.md) has what's planned.

## License

[MIT](./LICENSE)
