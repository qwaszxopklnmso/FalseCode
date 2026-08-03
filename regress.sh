#!/usr/bin/env bash
# One-shot full regression: fixtures + problems + examples + probes.
# Usage: ./regress.sh   (run from the project root)
set -u

cd "$(dirname "$0")"

[ -f .env.wsl.sh ] && source .env.wsl.sh

command -v node >/dev/null || { echo "node not found (source .env.wsl.sh first)"; exit 1; }

# Prefer `g++`; fall back to `g++.exe` (WSL/MinGW bridge).
CXX=""
for c in "${GXX:-}" g++ g++.exe; do
  if [ -n "$c" ] && command -v "$c" >/dev/null 2>&1; then CXX="$c"; break; fi
done
[ -n "$CXX" ] || { echo "g++ not found (source .env.wsl.sh first)"; exit 1; }
echo "using compiler: $CXX"

PASS=0
FAIL=0

note() { echo "$*"; }

check_compile() {
  local fc="$1"
  local cpp="${fc%.fc}.cpp"
  local exe="${fc%.fc}.exe"
  if node src/main.js "$fc" "$cpp" >/dev/null 2>&1 \
     && "$CXX" -std=gnu++11 -O0 -w -o "$exe" "$cpp" >/dev/null 2>&1; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "COMPILE FAIL: $fc"
  fi
}

note "== tests/run.js"
if node tests/run.js; then :; else echo "FAIL: tests/run.js"; fi

note ""
note "== problems_test/check.js"
if node problems_test/check.js; then :; else echo "FAIL: problems_test/check.js"; fi

note ""
note "== compile all example/*.fc"
for f in example/*.fc; do [ -e "$f" ] && check_compile "$f"; done

note ""
note "== compile all problems_test/*.fc"
for f in problems_test/*.fc; do [ -e "$f" ] && check_compile "$f"; done

note ""
note "== compile all tests/_probe/*.fc"
for f in tests/_probe/*.fc; do [ -e "$f" ] && check_compile "$f"; done

note ""
if [ "$FAIL" -eq 0 ]; then
  echo "ALL COMPILED OK ($PASS files)"
else
  echo "$FAIL compile failure(s), $PASS ok"
fi
