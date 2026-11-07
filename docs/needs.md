# Waiting on earlier steps

A step can need earlier steps. In `plan`, when a step it needs would change, the step reports `waiting` instead of
reading the host's state. It would read a machine that does not have that change yet, so it would give the wrong answer
or fail outright.

<!-- toc -->

- [How it works](#how-it-works)
- [When to use it](#when-to-use-it)
- [A prerequisite nothing in the script installs](#a-prerequisite-nothing-in-the-script-installs)

<!-- tocstop -->

```ts
const brew = await h.ensure("Install brew packages", { check: "brew bundle check", want: true, fix: "brew bundle" })

await h.ensure("Install fish plugins", {
  needs: [brew],
  check: async ({ read }) => (await read("fish -c 'fisher list'")).includes("jorgebucaran/fisher"),
  want: true,
  fix: "fish -c 'fisher update'",
})
```

On a fresh Mac, fish is not installed yet, so the plugin check's `read` would fail and fail the host in `plan`. With
`needs`, `plan` shows the step as waiting instead:

```
macbook
  ~ change:  (ensure) Install brew packages
  ? waiting: (ensure) Install fish plugins   needs 'Install brew packages'
```

## How it works

`needs` takes step results, the values earlier steps returned. `ensure`, `file`, and `link` accept it.

```ts
needs?: ChangeStepResult<"file" | "link" | "ensure">[]
```

- **In `plan`,** when any needed step would change or is waiting, the step reports `waiting` and doesn't read the
  host's state. Otherwise the step runs as usual.
- **In `apply`,** `needs` does nothing. The needed steps already ran, and a failed one stopped the host.
- **An empty `needs` is the same as leaving it out,** so a list the script computes can come out empty. An empty `after`
  is an error, because that run could never fire.
- **A waiting step counts as changed,** so a step that needs it waits too, and a follow-up like `after: [x]` shows up
  in the plan. `plan` errs toward showing too much rather than too little.
- **`ChangeStepResult` carries the step's name,** so `plan` can say what a step needs.
- **A run's result can't be needed.** A triggered run is `changed` exactly when the step that triggered it is, so need
  that step instead, because it is what this step's state depends on. A run with `after: "always"` would make every step that
  needs it wait on every plan. `ChangeStepResult` carries its step's `kind`, so passing a run's result is a type error, and
  an error at runtime for a script that gets past the types.
- **`run` does not take it.** A run never runs in `plan`, so there is no read to hold back.

## When to use it

Need an earlier step only when this step's state depends on that step's change. A step that reads something the
earlier step does not touch gives the right answer either way. `plan` already reminds you that steps after a change
were checked without it (see [Steps](./steps.md#what-plan-can-and-cannot-show)). `needs` is how you say exactly which
steps that applies to.

Naming the step you need has three effects:

- **Nothing upstream declares what it provides.** The step that needs another names it, and that is the whole link.
- **The language enforces the order.** A step's result does not exist until the step has run, so a step cannot need
  one that comes after it.
- **A helper says what it needs in its parameters,** as in `fishPlugins(h, { brew })`. It cannot be called before the
  steps it needs, because it needs their results.

## A prerequisite nothing in the script installs

Some things a host is expected to have already, like docker from a container's cloud-init profile. These need no
`needs`. The first step that uses one fails with the command's error, like
`exited with code 127: docker: command not found`.

For a friendlier message, check it with `inspect` and throw:

```ts
const docker = await h.inspect("command -v docker")
if (docker.exitCode !== 0) throw new Error("docker is missing: launch the container with the docker profile")
```

The host fails in `plan` too, with the message under the host script's name.
