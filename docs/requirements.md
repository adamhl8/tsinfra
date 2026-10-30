# Requirements

A requirement is a named check, like "docker is installed". Steps say which requirements they need and which ones they
provide. Code order stays the order things run. The library never reorders anything: it only checks that the order you
wrote makes sense.

<!-- toc -->

- [What happens when a step requires something](#what-happens-when-a-step-requires-something)
- [When `provides` matters](#when-provides-matters)

<!-- tocstop -->

```ts
declare function need(name: string, spec: { check: string; hint?: string }): Need
```

```ts
// lib/needs.ts
import { need } from "tsinfra"

export const docker = need("docker", {
  check: "command -v docker",
  hint: "launch the container with the docker profile",
})

export const fish = need("fish", { check: "command -v fish" })
```

```ts
await h.ensure("Start Immich", { requires: [docker], check: "...", fix: "docker compose up -d" })
```

Requirements are values rather than strings, so a typo is a compile error and jump-to-definition works. They are
compared by identity, so define each one once and import it. The name is only for output.

`requires` and `provides` are accepted by `ensure`, `ensureValue`, `file`, and `run`.

## What happens when a step requires something

Before the step does anything else, each of its requirements is checked:

1. **Run the requirement's `check` on the target.** If it passes, move on to the next requirement.
2. **If it fails, look for an earlier step on this host that provides it.**
   - In `plan`, if that step would change, the step reports `waiting` ("waits on Install docker") and its own check is
     not run. Running it would only report on a machine that does not have docker yet.
   - In `apply`, that step has already run. The requirement still failing means the provider did not deliver, so the
     step fails naming both.
3. **If nothing earlier provides it, the step fails** with "docker is missing" and the hint, if there is one. A step
   later in the script that provides it does not count. The host stops at the failure, so the fix is to move the
   provider earlier.

A `waiting` step counts as changed, so a follow-up like `if (x.changed)` shows up in the plan too. `plan` errs toward
showing too much rather than too little.

Requirements are not cached. Each one is re-checked whenever a step requires it, because the check is cheap and the
state may have changed since.

## When `provides` matters

Most requirements have no provider in the run. The Incus containers get Docker from a cloud-init profile, so `docker`
is just a check with a hint that names the missing profile.

`provides` matters when the same run installs the thing. On the Mac, the brew bundle step installs fish, and the fish
setup steps require it:

```ts
await h.ensure("Install brew packages", { provides: [fish], check: "...", fix: "..." })
await h.ensure("Make fish the login shell", { requires: [fish], check: "...", fix: "..." })
```

On a fresh Mac, `plan` shows the second step as waiting on the first, instead of a check that fails because fish is not
installed yet. This replaces the docstring in `~/homelab/pyinfra/lib/fish.py` that says to call `fish_setup` after
`brew_bundle`.
