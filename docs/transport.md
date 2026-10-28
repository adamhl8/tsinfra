# Transport

Two transports, local and SSH. Both run the same scripts the same way. The only difference is the command that starts
the remote shell.

<!-- toc -->

- [Commands travel on stdin](#commands-travel-on-stdin)
- [Login shells](#login-shells)
- [File writes](#file-writes)
- [SSH and ControlMaster](#ssh-and-controlmaster)
- [sudo](#sudo)

<!-- tocstop -->

```ts
export default host("sonarr.lan", async (h) => { ... }) // SSH, any target ssh accepts
export default host("@local", async (h) => { ... }) // the control machine itself
export default host("caddy.lan", { shell: "bash -l" }, async (h) => { ... })
```

`"@local"` is the same magic name pyinfra uses, and the one `~/homelab/pyinfra/inventory.py` already uses.

## Commands travel on stdin

Every command is sent as a script on stdin to a shell on the target. The command that starts that shell is always a
fixed string:

```sh
ssh <options> sonarr.lan sh -s          # SSH
sh -s                                   # local
ssh <options> sonarr.lan sudo -n sh -s  # sudo, either transport
```

The remote login shell only ever parses `sh -s`, so the content of a command never needs quoting for it. Whether that
login shell is bash or fish, nothing changes. This is the fix for the "three shells involved" quoting problem in
`~/homelab/archive/incus-update/utils.ts`.

The script is wrapped as `{ <script>\n} </dev/null`. The shell parses the whole group before running it, then runs it
with stdin from `/dev/null`. Without that wrapper, a command in the script that reads stdin (`apt` asking a question, a
nested `ssh`) would read the rest of the script as its input.

Output comes back as stdout, stderr, and an exit code. `ssh` itself exits 255 when the connection fails, so a 255
always gets the connection error from ssh's stderr rather than being treated as the command's exit code.

## Login shells

`sh -s` is not a login shell, so PATH additions from `.bashrc` or `.profile` do not load. The archived Bun scripts used
`bash -li` for exactly that (Go's path lives in `.bashrc` on the caddy container).

The host option `shell` replaces `sh` in the starting command, so `{ shell: "bash -l" }` runs `bash -l -s`. Generated
commands (the `file` check and write) are POSIX sh, so any `shell` must be POSIX compatible. fish is not.

## File writes

File content travels inside the write script, base64-encoded in a quoted heredoc:

```sh
umask 077
mkdir -p '<dir>'
base64 -d > '<tmp>' <<'TSINFRA_EOF'
<content as base64, wrapped at 76 columns>
TSINFRA_EOF
chmod 644 '<tmp>' && mv -f '<tmp>' '<dest>'
```

The shell parses the heredoc as part of the script, so the content arrives intact whatever the shell's buffering. The
paths are quoted inside the script, which the shell on the target parses, so there is still no quoting for the login
shell. No SFTP is involved, and secrets never appear in a command line. Base64 costs a third more bytes, which is cheap
for files small enough to manage this way.

An earlier draft streamed the raw bytes after the script and let `cat` read them. dash and busybox sh both read ahead on
stdin and swallow part of the content, so that only worked under bash and zsh. A 3 MB binary through the heredoc arrives
intact under dash, bash, busybox sh, zsh, and macOS `/bin/sh`.

With `sudo: true`, the starting command is `sudo -n sh -s`, so the whole write runs as root and ownership can be set.

## SSH and ControlMaster

tsinfra runs the system `ssh` binary. That means `~/.ssh/config`, `ProxyJump`, `known_hosts`, and the SSH agent
(including 1Password's) all work with no tsinfra configuration.

Every `ssh` call passes:

```sh
-o ControlMaster=auto -o ControlPath=~/.ssh/tsinfra-%C -o ControlPersist=60 -o BatchMode=yes
```

- **ControlMaster** makes the first `ssh` to a host open a connection and leave a socket on the control machine. Every
  later `ssh` to that host goes through the socket and skips the TCP connect, key exchange, and authentication, so a
  command starts in milliseconds.
- **ControlPath** uses `%C`, a hash of the connection details, which keeps the socket path short. Unix socket paths
  are limited to about 104 bytes on macOS. The `tsinfra-` prefix keeps these sockets apart from any the user configures.
- **ControlPersist** keeps the connection open for 60 seconds after the last command. That is a safety net, because the
  CLI closes each connection at the end of the run with `ssh -O exit`.
- **BatchMode** makes ssh fail instead of prompting. Hosts run in parallel, and a password or host-key prompt from one
  of them would hang the run. The error says to run `ssh <host>` once by hand.

The first command to a host opens the connection. An unreachable host fails at that point, with ssh's error.

## sudo

`sudo -n` never prompts, so v1 needs passwordless sudo (or cached credentials) on any host where a step uses
`sudo: true`. The Incus containers already have it, via cloud-init. The Mac and the first run on the Incus host do not.
See [Open questions](./open-questions.md).

On `step` and `run`, `sudo: true` covers the fix or the command only. A `step` check runs as the connecting user unless
the check itself says `sudo`, because the user writes that command.

On `file`, `sudo: true` covers the whole operation: the check, the diff, and the write. tsinfra generates all three, so
there is nowhere for the user to add `sudo`. A root-only file under `/etc` could not be hashed or read otherwise. This
means `plan` also needs passwordless sudo on a host that manages such a file.
