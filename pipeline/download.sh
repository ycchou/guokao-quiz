#!/usr/bin/env bash
# Download all 護理師 exam PDFs listed in dl_list.tsv
HERE="C:/Users/CHOUYU~1/AppData/Local/Temp/claude/D--Antigravity-test/29fc0220-e878-4878-b4db-3bcb06f53a94/scratchpad"
LIST="$HERE/dl_list.tsv"
LOG="$HERE/download.log"
: > "$LOG"
total=$(wc -l < "$LIST")
i=0; ok=0; skip=0; fail=0
while IFS=$'\t' read -r url path; do
  i=$((i+1))
  url=${url%$'\r'}; path=${path%$'\r'}
  fp=$(printf '%s' "$path" | tr '\\' '/')
  dir=$(dirname "$fp")
  mkdir -p "$dir"
  # skip if already a valid PDF
  if [ -s "$fp" ] && [ "$(head -c 4 "$fp")" = "%PDF" ]; then
    skip=$((skip+1)); continue
  fi
  curl -s -L --retry 3 --retry-delay 2 --max-time 120 -o "$fp" "$url"
  if [ -s "$fp" ] && [ "$(head -c 4 "$fp")" = "%PDF" ]; then
    ok=$((ok+1))
  else
    fail=$((fail+1))
    echo "FAIL [$i] $url -> $fp" >> "$LOG"
  fi
  if [ $((i % 25)) -eq 0 ]; then
    echo "progress $i/$total  ok=$ok skip=$skip fail=$fail" >> "$LOG"
  fi
  sleep 0.15
done < "$LIST"
echo "DONE total=$total ok=$ok skip=$skip fail=$fail" >> "$LOG"
