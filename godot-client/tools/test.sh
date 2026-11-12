#!/usr/bin/env bash
set -euo pipefail

project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
godot="${GODOT_BIN:-godot}"
logs="$(mktemp -d "${TMPDIR:-/tmp}/titan-godot-tests.XXXXXX")"
printf 'Godot test logs: %s\n' "$logs"

"$godot" --headless --path "$project" --import --log-file "$logs/import.log" > "$logs/import.out" 2>&1
if grep -q 'SCRIPT ERROR' "$logs/import.out"; then
  cat "$logs/import.out"
  exit 1
fi

for test in tests/odm_hud_test.gd tests/world_test.gd tools/bake-rigs-check.gd tests/traversal_smoke.gd \
    tests/traversal_gameplay.gd tests/combat_test.gd tests/titan_test.gd tests/game_flow.gd \
    tests/feedback.gd tests/network-interpolation.gd; do
  name="$(basename "$test" .gd)"
  output="$logs/$name.out"
  if ! "$godot" --headless --path "$project" --quit-after 2500 --log-file "$logs/$name.log" --script "res://$test" > "$output" 2>&1 \
      || grep -q 'SCRIPT ERROR' "$output" || ! grep -Eq '^PASS|validation passed|interpolation, rig, ODM cable and removal passed' "$output"; then
    cat "$output"
    exit 1
  fi
  grep -E '^PASS|validation passed|interpolation, rig, ODM cable and removal passed' "$output"
done
