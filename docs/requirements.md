# Requirements

A step can require earlier steps. In `plan`, when a step it requires would change, the step reports `waiting` instead
of running its check. Its check would run against a machine that does not have that change yet, so it would give the
wrong answer or fail outright.

<!-- toc -->

- [How it works](#how-it-works)
- [When to use it](#when-to-use-it)
- [A prerequisite nothing in the script installs](#a-prerequisite-nothing-in-the-script-installs)

<!-- tocstop -->

```ts
const brew = await h.ensure("Install brew packages", { check: "brew bundle check", want: true, fix: "brew bundle" })

await h.ensure("Install fish plugins", {
  requires: [brew],
  check: async ({ read }) => (await read("fish -c 'fisher list'")).includes("jorgebucaran/fisher"),
  want: true,
  fix: "fish -c 'fisher update'",
})
```

On a fresh Mac, fish is not installed yet, so the plugin check's `read` would fail and fail the host in `plan`. With
`requires`, `plan` shows the step as waiting instead:

```
macbook
  ~ Install brew packages
  ? Install fish plugins   waits on 'Install brew packages'
```

## How it works

`requires` takes step results, the values earlier steps returned. `ensure` and `file` accept it.

```ts
requires?: (StepResult | undefined)[]
```

- **In `plan`,** when any required step would change or is waiting, the step reports `waiting` and its check does not
  run. Otherwise the step runs as usual.
- **In `apply`,** `requires` does nothing. The required steps already ran, and a failed one stopped the host.
- **A waiting step counts as changed,** so a step that requires it waits too, and a follow-up like `after: [x]` shows up
  in the plan. `plan` errs toward showing too much rather than too little.
- **`StepResult` carries the step's name,** so `plan` can say what a step waits on.
- **`undefined` is accepted,** so a step that only runs on some code paths can be passed as it is.
- **`run` does not take it.** A run never runs in `plan`, so there is no check to hold back.

## When to use it

Require an earlier step only when this step's check depends on that step's change. A check that reads something the
earlier step does not touch gives the right answer either way. `plan` already reminds you that steps after a change
were checked without it (see [Steps](./steps.md#what-plan-can-and-cannot-show)). `requires` is how you say exactly
which steps that applies to.

Naming the step you depend on has three effects:

- **Nothing upstream declares what it provides.** The step that depends on another names it, and that is the whole
  link.
- **The language enforces the order.** A step's result does not exist until the step has run, so a step cannot require
  one that comes after it.
- **A helper says what it depends on in its parameters,** as in `fishPlugins(h, { brew })`. It cannot be called before
  the steps it needs, because it needs their results.

## A prerequisite nothing in the script installs

Some things a host is expected to have already, like docker from a container's cloud-init profile. These need no
requirement. The first step that uses one fails with the command's error, like
`exited with code 127: docker: command not found`.

For a friendlier message, check it with `inspect` and throw:

```ts
const docker = await h.inspect("command -v docker")
if (docker.exitCode !== 0) throw new Error("docker is missing: launch the container with the docker profile")
```

The host fails in `plan` too, with the message under the host's file name.
