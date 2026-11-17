#!/bin/sh
# Reports root under the fake `sudo`, and otherwise runs the real `id`.
if [ -z "${TSINFRA_FAKE_ROOT:-}" ]; then
  # Drop this script's directory, which the test session puts first on `PATH`.
  PATH="${PATH#*:}"
  exec id "$@"
fi

case "$1" in
  -u) echo 0 ;;
  *) echo root ;;
esac
