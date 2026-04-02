#!/usr/bin/env bash
set -euo pipefail

: "${FIDAN_URL:?}"
: "${FIDAN_SHA256:?}"
: "${FIDAN_BINARY_RELPATH:?}"
: "${FIDAN_INSTALL_DIR:?}"
: "${GITHUB_PATH:?}"

workdir="$(mktemp -d)"
archive="$workdir/fidan.tar.gz"
extract_dir="$workdir/extract"
mkdir -p "$extract_dir" "$FIDAN_INSTALL_DIR"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$FIDAN_URL" -o "$archive"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$archive" "$FIDAN_URL"
else
  echo "Neither curl nor wget is available to download Fidan." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual_sha="$(shasum -a 256 "$archive" | awk '{print $1}')"
else
  echo "Neither sha256sum nor shasum is available to verify the archive." >&2
  exit 1
fi

if [ "$actual_sha" != "$FIDAN_SHA256" ]; then
  echo "Checksum mismatch for downloaded Fidan archive." >&2
  echo "Expected: $FIDAN_SHA256" >&2
  echo "Actual:   $actual_sha" >&2
  exit 1
fi

tar -xzf "$archive" -C "$extract_dir"

candidate="$extract_dir/$FIDAN_BINARY_RELPATH"
if [ ! -f "$candidate" ]; then
  first_dir="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -type d | head -n 1 || true)"
  if [ -n "$first_dir" ] && [ -f "$first_dir/$FIDAN_BINARY_RELPATH" ]; then
    candidate="$first_dir/$FIDAN_BINARY_RELPATH"
  fi
fi

if [ ! -f "$candidate" ]; then
  echo "Downloaded archive does not contain expected binary: $FIDAN_BINARY_RELPATH" >&2
  exit 1
fi

install_path="$FIDAN_INSTALL_DIR/$FIDAN_BINARY_RELPATH"
mkdir -p "$(dirname "$install_path")"
cp "$candidate" "$install_path"
chmod +x "$install_path" || true
printf '%s\n' "$(dirname "$install_path")" >> "$GITHUB_PATH"
rm -rf "$workdir"