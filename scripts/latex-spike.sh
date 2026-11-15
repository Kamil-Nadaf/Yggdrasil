#!/usr/bin/env bash
# Compare Tectonic with the full TeX toolchain (latexmk) on a set of sample documents.
# Usage:  scripts/latex-spike.sh            (writes docs/latex-spike-results.md)
# Needs:  tectonic on PATH (brew install tectonic) and latexmk (TinyTeX/MacTeX) for the comparison column.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; SRC="$HERE/latex-spike"; OUT="$HERE/../docs/latex-spike-results.md"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
now() { python3 -c 'import time;print(time.time())'; }
run() { # name cmd... -> sets RES_OK RES_T
  local s e; s=$(now); "$@" >"$WORK/last.log" 2>&1; local rc=$?; e=$(now)
  RES_T=$(python3 -c "print(round($e-$s,1))"); [ $rc -eq 0 ] && RES_OK=OK || RES_OK=FAIL
}
{
echo "# LaTeX engine spike ($(date +%F), $(uname -sm))"; echo
echo "tectonic: $(tectonic --version 2>&1 | head -1)"; echo "latexmk: $(latexmk -v 2>&1 | head -2 | tail -1)"; echo
echo "| Document | Tectonic cold | Tectonic warm | latexmk |"; echo "|---|---|---|---|"
for f in "$SRC"/*.tex; do
  n=$(basename "$f" .tex); d="$WORK/$n"; mkdir -p "$d"; cp "$SRC"/*.bib "$f" "$d"/
  ( cd "$d"; run tectonic -X compile "$n.tex" --outdir "$d/t1" --keep-logs; c="$RES_OK ${RES_T}s"
    run tectonic -X compile "$n.tex" --outdir "$d/t2" --keep-logs; w="$RES_OK ${RES_T}s"
    if command -v latexmk >/dev/null; then run latexmk -pdf -interaction=nonstopmode -shell-escape -outdir="$d/l" "$n.tex"; l="$RES_OK ${RES_T}s"; else l="n/a"; fi
    echo "| $n | $c | $w | $l |" )
done
} | tee "$OUT"
echo; echo "Saved to $OUT"
