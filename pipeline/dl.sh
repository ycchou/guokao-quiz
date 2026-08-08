#!/usr/bin/env bash
# Generic downloader: dl.sh <list.tsv>  (lines: url<TAB>winpath)
LIST="$1"
LOG="${LIST%.tsv}.log"
: > "$LOG"
total=$(wc -l < "$LIST")
i=0; ok=0; skip=0; fail=0
while IFS=$'\t' read -r url path; do
  i=$((i+1))
  url=${url%$'\r'}; path=${path%$'\r'}
  fp=$(printf '%s' "$path" | tr '\\' '/')
  mkdir -p "$(dirname "$fp")"
  if [ -s "$fp" ] && [ "$(head -c 4 "$fp")" = "%PDF" ]; then
    skip=$((skip+1)); continue
  fi
  curl -s -L --retry 3 --retry-delay 2 --max-time 120 -o "$fp" "$url"
  if [ -s "$fp" ] && [ "$(head -c 4 "$fp")" = "%PDF" ]; then
    ok=$((ok+1))
  else
    fail=$((fail+1)); echo "FAIL [$i] $url -> $fp" >> "$LOG"
  fi
  [ $((i % 25)) -eq 0 ] && echo "progress $i/$total ok=$ok skip=$skip fail=$fail" >> "$LOG"
  sleep 0.15
done < "$LIST"
echo "DONE total=$total ok=$ok skip=$skip fail=$fail" >> "$LOG"
echo "DONE total=$total ok=$ok skip=$skip fail=$fail"
