#!/usr/bin/env bash
# Copies the Symbiosis library page into the studio's public/ folder.
#
# The page under test is shipped inside the emulator APK, so this repo keeps a
# byte-identical copy. Drift here would make every green check a lie: the page
# that passes would not be the page on the phone.
#
# Usage:
#   bash tools/sync-symbiosis.sh /path/to/symbiosis
#   bash tools/sync-symbiosis.sh --check /path/to/symbiosis
set -euo pipefail

SRC_DEFAULT="../symbiosis/docs/library.html"
CHECK=0
if [ "${1:-}" = "--check" ]; then CHECK=1; shift; fi
SRC="${1:-$SRC_DEFAULT}/docs/library.html"
[ -f "$SRC" ] || SRC="${1:-$SRC_DEFAULT}"

DST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/public/symbiosis/library.html"
[ -f "$SRC" ] || { echo "нет файла: $SRC" >&2; exit 1; }

if [ "$CHECK" = "1" ]; then
  if cmp -s "$SRC" "$DST"; then
    echo "ok: страница совпадает ($(sha256sum "$SRC" | cut -c1-16))"
  else
    echo "РАСХОДИТСЯ: $SRC и $DST" >&2
    diff <(sha256sum "$SRC") <(sha256sum "$DST") >&2 || true
    exit 1
  fi
else
  cp "$SRC" "$DST"
  echo "скопировано: $(sha256sum "$DST" | cut -c1-16)  $(wc -c < "$DST") Б"
fi
