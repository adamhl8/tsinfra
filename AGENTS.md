# AGENTS.md

tsinfra's design lives in the docs: `docs/README.md` (the design notes), `docs/steps.md`, `docs/cli.md`,
`docs/transport.md`, `docs/needs.md`, `docs/recipes.md`, and `docs/roadmap.md`. Read the doc for the area you're
working on. This file holds only what the docs and the code don't make obvious.

## Working with the user

- Give the user a rundown of the next piece and get their go-ahead before building it.
- Larger work is split into pieces, each reviewed before the next.

## Checks

- `bunx bask test --all`, for changes to transports, sudo, or file and link writes. The `*.docker.ts` tests run on
  Alpine (busybox) and Debian (dash), with real root and real `sudo`. Neither `bun test` nor `bask lint` runs them.
- A test that sends content near the 10 MB limit through the local `sh` needs `CONTENT_LIMIT_TIMEOUT_MS`. macOS
  `/bin/sh` is bash, which reads a script on a pipe one byte at a time, so 10 MB takes about 2.5 seconds of the default
  5 second timeout.

## Docs

The docs describe tsinfra as it is. Everything not built lives in `docs/roadmap.md`.

- A new design for an unbuilt feature goes in the roadmap, not in the doc it will later belong to.
- When a piece is built, move its design out of the roadmap into the current-state doc and delete the roadmap entry.
- Other docs link to roadmap anchors for gaps.

## Vocabulary

Check new names, comments, docs, and error messages against these words.

- **Host** is the machine a script configures, in code and prose ("runs on the host", `HostFile` for the file found
  at a path).
- **Target** is only the connection address in `host({ name, target }, fn)` (like `@local`, `sonarr.lan`) and a symlink's target
  in `h.link`.
- **Host script** is a file in `hosts/` (`HostScript`, `HOST_SCRIPT_EXTENSION`, the `hostScript` name kind), never
  "host file".
- **Change** is anything that modifies the host (the summary's `N changes`). **Drift** is a change a step that reads
  the host found (a `changed` status), or a run that only changes still open from an earlier apply triggered (a
  `ranFromOpenChanges` status). Those are the only things that make `plan` exit 2. **Run** is a change with no drift
  behind it. Don't coin a word for non-drift changes.
- **Read step** is a step that tells the script about the host (`read`, `inspect`). **Change step** is a step that can
  change the host, whether or not it does (`file`, `ensure`, `run`, `link`, `dir`, later `reboot`).
- **Tools** are named for what they can do, not which step has them. A check function gets `ReadTools`, even though
  `ensure` is a change step, and a fix or run function gets `ChangeTools`.
- **Meta** is what `h` holds besides its steps, known before the script runs (`h.meta`, `HostMeta`), like the host's
  name and sudo password. A value goes in it only when it's about the host and isn't a step.
- **Fact** is only something read from the host, like the CPU architecture. What a report shows under a step is its
  **details**.
- **State** appears only in prose, for the host's version of something, not in identifiers (`compareFile`, not
  `compareFileState`). The "state command" is the exception, because it's a documented term.
- **Saved state** is what tsinfra itself keeps on a host between applies (`~/.tsinfra/state/<host>.json`, the
  `saved-state` package), in code and prose, so it never reads as the host's state. Inside that package, plain `state`
  in a local name is fine where the context is clear. **Open changes** are the first part of saved state. A step
  that's right, but whose change is still open from an earlier apply, is **`resume`**.
- **Follow-up** is a step whose `after` names the steps it follows, today a `run` and later a `reboot`. Use it, not
  "run", in code that would apply to any of them, like `recordFollowUp(followUpName, stepNames)`.
- **Integration** is a set of functions that take `h` and call steps to set up one specific program, service, or piece
  of config, like apt packages or systemd units (see the roadmap's Integrations worth shipping), never "helper",
  "module", or "provider". A function a script writes for itself, without that scope, can still be a helper.
- **Preparation** is what runs before a host's script, never "preflight" or "host failure".
- **"Outcome"** isn't a term in the code.
- **"Note"** is the report's word. **"Diff"** means the line output in the report, so it doesn't name a comparison.
- **"Owner"** stays the plain word for the concept and for the chmod permission class. The option is `user`, to pair
  with `group` and match `stat` and `chown user:group`. `FileOwner` is the type both take.
- **A `want`'s kinds** are boolean, string, list, set, and record, in code, comments, docs, and test names
  (`RecordWant`, "a record `want`"). Never call a record an "object `want`" or a list an "array `want`". A list and a
  set are different kinds, so neither word stands in for the other. An error message names the JS type where it says
  what a value must be, like "an array of strings, a Set of strings, or an object of strings, numbers, or booleans", so
  a reader can match it to their value. Where it talks about a kind, it uses the kind's name, like "a record want needs
  a check function".

## Naming values from the host

Each name should say which side of a comparison it is. When naming anything in a compare or write function, check
whether a reader could mistake it for the wanted value or the host's value.

- A value read from the host that sits next to a wanted value is `current...`: `currentTarget` (what a link points to
  now), `currentOwner` (who owns the path now). The wanted side keeps the plain input name (`target`, `options.user`).
- `attributes` always means a file's actual attributes (`HostFileAttributeDetails`). The wanted side is always
  `options`.
- A list of differences is `...Changes`: `attributeChanges`, `ownerChanges`. A single one is `LinkChange`,
  `ModeChange`, `OwnerChange`.
- Don't prefix a local with `host` just to say it came from the host. Keep `host` when it names the host itself
  (`hostSession`, `hostReport`), when it matches a type and its producer (`hostFileDetails` from
  `getHostFileDetails`), or when it's the only thing telling two values apart (`hostContentDetails` next to
  `resolvedContent`).
- A discriminant read off details gets a name that isn't plain `kind`, because `kind` means the step kind
  (`linkDetailsKind`).

## Writing

- **Wrappers.** When a comment, JSDoc, doc, or plan describes wrappers (a transport wrapping a transport, a shell
  around a transport, recorders), say what wraps what ("wraps", "around") or the order a command passes through
  ("before the root transport wraps it in `sudo sh -s`"). Never say "above" or "below", because readers picture a
  wrapper stack in either direction.
- **Formatting.** All formatting belongs in the report. That covers recorded values, not error messages. An error
  message can format what it needs, like `prettyBytes` in the size limit error.

## Layout

- **`src/` holds the CLI (`cli.ts`), the report (`report.ts`), and `core/`,** plus the published `index.ts` and code
  all three share (`mode.ts`, `styles.ts`, `utils.ts`). `core/` holds hosts, the session, and transports, the part of
  tsinfra that does the work. Nothing in `core/` imports the CLI or the report.

## Architecture

- **`session.ts` is the only code that throws.** Everything the script can call (the `h` methods and the tools) is
  `callOrFail` around a `Result`-returning internal.
- **Handlers never record anything.** What a step has one of is returned (`HandlerReturn { status, value }`), and what
  it has zero or more of is recorded by a wrapper it runs through.
- **A check reports the same** whether it's a command string or a function with one `inspect`.
- **`runProcess` doesn't pass `env` to `spawn`,** so a host script's changes to `process.env` never reach the commands
  tsinfra runs. Bun's `spawn` gives children the environment the process started with, so a test can't move `HOME`
  either. Instead, the test preload mocks `buildHostDetails` to give each host a temp `home`, ssh ones included,
  because the only sshds the tests reach run on the same machine as the same user.
- **Paths tsinfra keeps under a host's home come from `core/hosts/prepare/host-details/tsinfra-directory.ts`,** built
  from the checked `HomeDirectory`, never as `"$HOME"` in a script. The test preload's mock swaps `home` on what
  `buildHostDetails` returns, so it reaches paths built after preparation, like saved state. It doesn't reach the
  askpass helper, which `buildHostDetails` writes itself, so tests find the helper in the real home.
- **`report-preview.ts` has no test preload,** so it runs its hosts in a child process started with a temp `HOME`.
  Otherwise each host that fails there leaves its saved state in the real `~/.tsinfra/state/`.
- **Recorders follow the stages of a run** (preparation, then the session), not the host, step, and converge
  hierarchy.

### `src/core/session/handlers/`

`handlers/` is the boundary where arguments from the script enter, so the rule is visible from the file tree.

- The top level holds only handlers. Each takes the script's values as `unknown` and validates them, with the public
  types and schemas for that input next to it: one file per step, and `tools.ts`.
- `handlers/<step>/` holds one handler's own stages, named without the step prefix. A step's own read, comparison, and
  write stay in its folder.
- `handlers/shared/` holds code more than one handler uses. Its helpers may take `unknown` and validate it, like
  `validateInput` and `validateHostPath`. It's for building blocks no one step owns.
- A step can build on another step's internals. It imports them from the module that declares them, like `dir`
  importing `compareRecords` from `ensure/comparison/record.ts`.
- `handlers/shared/filesystem/` holds the filesystem building blocks (paths, owners, modes, sizes, attribute types,
  write-script pieces), even when only one step uses one.
- `handlers/options/` holds every options interface a step's options extend. Each handler keeps its own options
  interface and schema, extending these.
- A value a script function returns is validated where it's used, not in `handlers/`'s top level.
