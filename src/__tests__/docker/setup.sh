#!/bin/sh
# Runs inside a container as root, with the repo at /repo: it sets up users and sudo, then runs the tests.
set -eu

distro="$1"

case "$distro" in
  alpine)
    apk add --no-cache sudo >/dev/null
    for user in tester sonarr nopass; do adduser -D "$user"; done
    ;;
  debian)
    apt-get update -qq >/dev/null
    apt-get install -y -qq sudo >/dev/null 2>&1
    for user in tester sonarr nopass; do useradd -m "$user"; done
    ;;
  *)
    echo "unknown distro '$distro'" >&2
    exit 1
    ;;
esac

echo 'tester ALL=(ALL) NOPASSWD: ALL' >/etc/sudoers.d/tester
chmod 440 /etc/sudoers.d/tester

# Copy the repo, because the tests write to it, and install again, because node_modules holds the host's binaries.
mkdir /work
tar -C /repo --exclude=./.git --exclude=./dist --exclude=./node_modules --exclude=./.terraform -cf - . | tar -C /work -xf -
cd /work
bun install --frozen-lockfile --ignore-scripts >/dev/null
chown -R tester /work
chmod -R a+rX /work

failed=0

# Prints a heading and runs `bun test` with its args as `user`, recording a failure and carrying on.
run_tests() {
  heading="$1"
  user="$2"
  shift 2
  echo "--- $heading"
  # Set `USER`, because `os.userInfo` in Bun reads the name from it.
  su "$user" -s /bin/sh -c "cd /work && USER=$user PATH=$PATH bun test $*" || failed=1
}

run_tests "the test suite as a non-root user" tester
run_tests "the test suite as root" root
run_tests "real sudo and real root" tester ./src/session/handlers/__tests__/file-sudo.docker.ts ./src/session/handlers/__tests__/link-sudo.docker.ts
run_tests "a user with no sudo rule" nopass ./src/session/handlers/__tests__/file-no-sudo.docker.ts

exit "$failed"
