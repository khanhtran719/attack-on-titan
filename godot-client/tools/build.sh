#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
godot="${GODOT_BIN:-godot}"
kind="${1:-web}"

case "$kind" in
  web) preset=Web; directory=web; filename=index.html ;;
  macos) preset=macOS; directory=native; filename=TitanHunter.zip ;;
  *) printf 'Usage: %s [web|macos]\n' "$0" >&2; exit 2 ;;
esac

destination="$project/exports/$directory"
mkdir -p "$destination"
staging="$(mktemp -d "$project/exports/.$kind.XXXXXX")"
"$godot" --headless --path "$project" --import --log-file "$project/exports/import.log"
if [[ "$kind" == web ]]; then
  node "$project/multiplayer/build-bridge.mjs" "$staging/coop-bridge.js"
fi
"$godot" --headless --path "$project" --export-release "$preset" "$staging/$filename" --log-file "$project/exports/export-$kind.log"
test -s "$staging/$filename"
mv -f "$staging"/* "$destination/"
rmdir "$staging"
printf 'Exported %s\n' "$destination/$filename"
