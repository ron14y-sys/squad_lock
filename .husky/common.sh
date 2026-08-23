# Git hooks do not load your shell profile, so PATH here is not the PATH you
# see in a terminal. On this machine Node lives in a directory that is on
# neither, which made every hook fail with "npm: command not found". Find Node
# ourselves rather than depending on how the hook happened to be launched.

if ! command -v npm >/dev/null 2>&1; then
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin" "$HOME/.local/bin"; do
    if [ -x "$dir/npm" ]; then
      PATH="$dir:$PATH"
      export PATH
      break
    fi
  done
fi

# Version managers keep Node outside any fixed directory.
if ! command -v npm >/dev/null 2>&1; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "" >&2
  echo "This hook needs Node, and cannot find it." >&2
  echo "Install Node, or point the hook at it by creating ~/.config/husky/init.sh" >&2
  echo "containing a line that adds your Node directory to PATH." >&2
  echo "" >&2
  exit 1
fi
