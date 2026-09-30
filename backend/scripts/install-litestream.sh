#!/bin/sh
set -eu

version=0.5.17
sha256=cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d

if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "install-litestream: expected Linux x86_64, got $(uname -s) $(uname -m)" >&2
  exit 1
fi

bin="$(cd "$(dirname "$0")/.." && pwd)/bin"
tarball="litestream-$version-linux-x86_64.tar.gz"

mkdir -p "$bin"
curl -fsSL -o "$bin/$tarball" "https://github.com/benbjohnson/litestream/releases/download/v$version/$tarball"
echo "$sha256  $bin/$tarball" | sha256sum -c -
tar -xzf "$bin/$tarball" -C "$bin" litestream
rm "$bin/$tarball"
