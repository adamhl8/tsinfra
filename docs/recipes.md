# Recipes

Patterns that need no tsinfra feature, only the steps as they are.

<!-- toc -->

- [A template is a function](#a-template-is-a-function)
- [Paths on the control machine](#paths-on-the-control-machine)
- [An idempotence check](#an-idempotence-check)
- [Checking a whole config with `run`](#checking-a-whole-config-with-run)
- [Removing a path with `ensure`](#removing-a-path-with-ensure)
- [A directory](#a-directory)
- [Turn a step into its removal instead of deleting it](#turn-a-step-into-its-removal-instead-of-deleting-it)
- [The state you want, or what's left to do](#the-state-you-want-or-whats-left-to-do)
- [Running the latest container images](#running-the-latest-container-images)
- [A reboot](#a-reboot)
- [Waiting for a change to take effect](#waiting-for-a-change-to-take-effect)
- [A config file an app owns](#a-config-file-an-app-owns)
- [A directory of files](#a-directory-of-files)
- [A value from your own environment in a `sudo` command](#a-value-from-your-own-environment-in-a-sudo-command)
- [A program that runs sudo itself](#a-program-that-runs-sudo-itself)

<!-- tocstop -->

## A template is a function

Put a template in its own `.ts` file, which gives typed parameters, plain loops and conditionals, and a template that
tests can call:

```ts
// files/caddyfile.ts
export const caddyfile = (site: { domain: string; port: number }) => `${site.domain} {
  reverse_proxy localhost:${site.port}
}
`

// hosts/sonarr.ts
await h.file("/etc/caddy/Caddyfile", caddyfile({ domain: "sonarr.lan", port: 8989 }), { sudo: true })
```

A template literal inside indented code keeps that indentation, so keep templates at the top level of their file, or
use [`dedent`](https://www.npmjs.com/package/dedent) or `outdent` inline. Someone porting Jinja files can render them
with Nunjucks and pass the output as a string.

## Paths on the control machine

Build them with `import.meta.dir` in a `lib/paths.ts` (see [Steps](./steps.md#file)).

## An idempotence check

In a container, `apply`, then `plan` expecting exit 0.

## Checking a whole config with `run`

A fragment that only makes sense with the rest of a config is checked after it's in place, like
`h.run("Reload nginx", "nginx -t && systemctl reload nginx", { after: [site] })`. A `run` with `after: "always"` that
runs `sshd -t` checks the live config on every `apply`, which catches a config that a new version of the tool no longer
accepts. `validate` is for a file that must never be broken, even for a moment.

## Removing a path with `ensure`

Check `test -e path || test -L path` with `want: false`, because `test -e` is false for a dead link, so a check with
`-e` alone never removes one.

## A directory

Use [`dir`](./steps.md#dir). It makes the directory and any missing parents, and manages its mode and owner when they're
given:

```ts
await h.dir("/srv/sonarr", { mode: GROUP_DIRECTORY_MODE, user: "sonarr", group: "sonarr", sudo: true })
```

Write an `ensure` only for what `dir` doesn't manage, like a directory's ACLs or its SELinux context. Removing a
directory is an `ensure` too (see [Removing a path with `ensure`](#removing-a-path-with-ensure)).

## Turn a step into its removal instead of deleting it

A deleted step leaves what it made on the host, and tsinfra can't know how to undo it (see
[Removed resources](./roadmap.md#removed-resources)). Edit the step, and delete it once every host has applied it. Name
each direction, because a boolean check shows no values under its `~` line. A function keeps both directions side by
side:

```ts
// lib/docker.ts
export const docker = async (h: Host, { present }: { present: boolean }) =>
  h.ensure(present ? "Install Docker" : "Remove Docker", {
    want: present,
    check: "command -v docker",
    fix: present ? INSTALL_DOCKER : REMOVE_DOCKER,
  })

// hosts/sonarr.ts
await docker(h, { present: false })
```

## The state you want, or what's left to do

A `want` for several things, like packages, is a set, a list, or a record, and it takes one of two shapes. Either it's
the state you want, and the check returns the host's state the same way, or it's `[]`, and the check lists what's left
to do. Prefer the state you want, because `plan` then shows exactly which items the fix will change.

**Compute the state you want** whenever you can work it out before the step. `want` is a plain value, so it can come
from a constant, a `fetch` on the control machine, or an `h.read` before the step. A `Set` suits a set of names, like
packages that should be installed. A record suits names with a value each, like packages on a version each. For
global Bun packages, each on the newest version its spec allows:

```ts
const wanted: Record<string, string> = {}
for (const [name, spec] of Object.entries(specs)) {
  wanted[name] = await h.read('bun pm view "$SPEC" version', { env: { SPEC: `${name}@${spec}` } })
}

await h.ensure("Sync bun global packages", {
  want: wanted,
  check: async ({ read }) => toVersions(await read("bun pm ls -g")),
  fix: async ({ exec }, { extra, unmet }) => {
    const installs = Object.entries(unmet).map(([name, version]) => `${name}@${version}`)
    if (installs.length > 0) await exec(`bun add -g ${installs.join(" ")}`)
    if (Object.keys(extra).length > 0) await exec(`bun remove -g ${Object.keys(extra).join(" ")}`)
  },
})
```

`specs` maps each package to its range, like `{ pnpm: "11", turbo: "latest" }`, and `toVersions` turns the listing into
the same name-to-version shape. The fix installs each package in `unmet` at its wanted version, and removes each one
in `extra`. `plan` shows a row per package that differs:

```
  ~ change: (ensure) Sync bun global packages
      zx:         (none) -> 8.8.1
      pnpm:       11.1.0 -> 11.2.0
      typescript: 5.9.2 -> (none)
```

**List what's left, with `want: []`,** when the tool works out the difference itself, like `brew outdated`,
`apt list --upgradable`, or a newer image digest (see
[Running the latest container images](#running-the-latest-container-images)). Writing out the state you want there
means asking for every item's newest version, which is slower and longer than the tool's own answer. The fix runs only
while the list isn't empty, and the check after the fix confirms the list emptied. A boolean would only say
"something". `plan` shows each item as a `-` line, because you want none of it.

**List what's left when the state you want depends on an earlier step.** `h.read` runs when the script reaches it and
takes no `needs`, so in `plan` it reads the host before an earlier change is applied. A version from a registry doesn't
depend on earlier steps, so reading it first is fine. When the state you want comes from something an earlier step
changes, work out what's left inside the check, and give the step `needs` (see [Waiting on earlier steps](./needs.md)).

## Running the latest container images

This is a `want: []` `ensure`. The check reads the registry's digest without pulling, and compares it with the image
each running container started from, because pulling in a check breaks the rule on what a check may change (see
[Steps](./steps.md#what-a-check-may-change)). The exact `docker` commands are unconfirmed:

```ts
await h.ensure("Run the latest images", {
  want: [],
  check: async ({ read }) => {
    const outdated: string[] = []
    for (const { service, image } of services) {
      const remote = await read(`docker buildx imagetools inspect ${image} --format '{{.Manifest.Digest}}'`)
      const running = await read(`docker inspect --format '{{.Image}}' $(docker compose ps -q ${service})`)
      if (!(await isSameImage(read, running, remote))) outdated.push(service)
    }
    return outdated
  },
  fix: "docker compose pull && docker compose up -d",
})
```

`plan` shows a change only when a newer image exists, naming the services. It reads the registry on every plan, one
manifest request per image, which Docker Hub doesn't count against its pull limit.

**Use with caution: pulling in the check.** It's simpler, and it breaks tsinfra's rule that `plan` changes nothing the
script manages. Every `plan` pulls, which moves each image tag on the host, so a `docker compose up -d` run by anything
afterwards starts the new image, even though nothing was applied. Every plan also downloads, and counts against Docker
Hub's pull limit, which an hourly drift check can reach. Use it only if those costs are fine for this host:

```ts
await h.ensure("Run the latest images", {
  want: [],
  check: async ({ read }) => {
    await read("docker compose pull")
    const outdated: string[] = []
    for (const { service, image } of services) {
      const pulled = await read(`docker image inspect --format '{{.Id}}' ${image}`)
      const running = await read(`docker inspect --format '{{.Image}}' $(docker compose ps -q ${service})`)
      if (pulled !== running) outdated.push(service)
    }
    return outdated
  },
  fix: "docker compose up -d",
})
```

## A reboot

tsinfra has no reboot step yet (see [Reboot](./roadmap.md#reboot)), so a reboot is an `ensure` after the steps that
need it. The check reads the state only a reboot brings, and the fix schedules the reboot and fails the host on
purpose:

```ts
await h.ensure("Reboot to load ZFS", {
  want: true,
  check: "test -e /sys/module/zfs",
  fix: "sudo systemd-run --on-active=5 systemctl reboot && echo 'rebooting, rerun in a minute' >&2 && exit 1",
})
```

`systemd-run` delays the reboot, so the command returns before the connection drops. The failure skips the rest of the
host's steps, and the next run starts past this one, because the check passes after the reboot. `plan` shows it as a
change, which a bare `throw` in the script wouldn't. For a kernel update, compare `uname -r` with the newest
`/boot/vmlinuz-*`. The same shape works as a pause for a manual login, with a fix that only fails with the
instructions, like `ssh in and run 'ob login'`, until manual steps exist (see [Manual steps](./roadmap.md#manual-steps)).

## Waiting for a change to take effect

Some commands return before their change shows. `launchctl bootout` returns before the job is gone, so a `bootstrap`
straight after it fails with an I/O error, and `launchctl bootstrap` returns before the job is running. The check after
the fix would then see the old state and fail the step. Wait at the end of the fix, until the state is what you want or
a time limit passes:

```ts
import type { Inspect } from "tsinfra"

const label = "com.example.exporter"
const job = `gui/$(id -u)/${label}`

// Match one tab, because nested sections in `launchctl print` have `state` lines of their own.
const readJobState = async (inspect: Inspect) => {
  const { stdout, exitCode } = await inspect(`launchctl print "${job}"`)
  if (exitCode !== 0) return "not loaded"
  return /^\tstate = (.+)$/m.exec(stdout)?.[1] ?? "unknown"
}

const waitForJobState = async (inspect: Inspect, state: string) => {
  const deadline = Date.now() + 30_000
  while ((await readJobState(inspect)) !== state && Date.now() < deadline) await Bun.sleep(500)
}

await h.ensure(`Run ${label}`, {
  want: "running",
  check: async ({ inspect }) => readJobState(inspect),
  fix: async ({ exec, inspect }) => {
    if ((await readJobState(inspect)) !== "not loaded") {
      await exec(`launchctl bootout "${job}"`)
      await waitForJobState(inspect, "not loaded")
    }
    await exec(`launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/${label}.plist"`)
    await waitForJobState(inspect, "running")
  },
})
```

A built-in way to wait is planned (see [Waiting for a fix to take effect](./roadmap.md#waiting-for-a-fix-to-take-effect)).

- **Wait in the fix, not the check.** The check also runs in `plan`, so a wait there slows every `plan`.
- **Stop waiting without throwing.** When time runs out, the check after the fix fails the step with what it found,
  like `got: spawn scheduled`, which says more than a timeout error.
- **Check that it's running, not that it's loaded.** launchd keeps a `KeepAlive` job loaded while it crashes on every
  start, so a check for loaded passes on a broken job. On systemd, check `systemctl is-active`, not `is-enabled`.

## A config file an app owns

Some apps create their config on first start and rewrite it when a setting changes in their UI, like Sonarr's
`config.xml`. Seed it before the first start with `overwrite: false`, so the app starts with your values, then manage
each value you care about with its own `ensure`:

```ts
const configPath = "/home/alice/.sonarr/config.xml"
await h.file(configPath, `<Config><Port>8000</Port><ApiKey>${sonarrApiKey}</ApiKey></Config>\n`, {
  secret: true,
  overwrite: false,
})
await h.ensure("Set Sonarr's port", {
  want: "<Port>8000</Port>",
  check: `grep -o '<Port>[0-9]*</Port>' ${configPath}`,
  fix: `sed -i 's|<Port>[0-9]*</Port>|<Port>8000</Port>|' ${configPath} && sudo systemctl restart sonarr`,
})
```

The seed avoids waiting for the app to create the file, and puts an API key from sops in place before anything reads
it. An app that writes its whole config when it stops, like qBittorrent, needs the fix to stop it, edit, then start it,
or the app's copy overwrites the edit.

## A directory of files

A built static site, for example, is one `file` step per file, from a loop over the local directory:

```ts
import path from "node:path"

import { Glob } from "bun"

const siteDir = path.join(import.meta.dir, "../site/dist")
for await (const relativePath of new Glob("**/*").scan({ cwd: siteDir })) {
  await h.file(`~/dist/${relativePath}`, Bun.file(path.join(siteDir, relativePath)))
}
```

`file` creates missing parent directories, and `dir` sets a directory's mode and owner when they matter (see
[A directory](#a-directory)). A file removed from the local directory stays on the host, so
remove it with its own step, or rebuild the directory.

## A value from your own environment in a `sudo` command

`sudo` resets the environment, and Debian's `secure_path` replaces `PATH` even with `sudo -E`. Read the value as yourself
first, and put `sudo` only on the part that needs root:

```ts
fix: 'fish_path="$(command -v fish)" && echo "$fish_path" | sudo tee -a /etc/shells && sudo chsh -s "$fish_path" "$USER"'
```

`command -v fish` runs with your `PATH`, and the variable expands before `sudo` sees it, so root's `PATH` never matters.

## A program that runs sudo itself

A program that runs `/usr/bin/sudo` itself never sees tsinfra's `sudo` function, so it can't get the password the way
a command's own `sudo` does (see [Transport](./transport.md#sudo)). Homebrew does this when a cask installs a `.pkg`.
Give it the password from `h.meta.sudoPassword` the way the program takes it.

Homebrew runs `sudo -A` when `SUDO_ASKPASS` is set, and keeps only its own `HOMEBREW_*` variables, so the helper reads
the password from one:

```ts
// Give an absolute path, because sudo does not expand `~` in `SUDO_ASKPASS`.
const helperPath = "/Users/me/.local/bin/brew-askpass"
await h.file(
  helperPath,
  String.raw`#!/bin/sh
printf '%s\n' "$HOMEBREW_SUDO_PASSWORD"
`,
  { mode: "755" },
)

const { sudoPassword } = h.meta
const askpass =
  sudoPassword === undefined
    ? {}
    : { env: { SUDO_ASKPASS: helperPath }, secretEnv: { HOMEBREW_SUDO_PASSWORD: sudoPassword } }

await h.run("Upgrade casks", "brew upgrade --cask", { after: "always", ...askpass })
```

- **The helper holds no secret.** It only prints the variable, which `secretEnv` sets for that one step.
- **`SUDO_ASKPASS` is set only with a password.** Homebrew runs `sudo -A` whenever it's set, so a helper with nothing to
  print would fail the cask.
