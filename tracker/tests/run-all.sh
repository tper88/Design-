#!/bin/sh
# Pełna weryfikacja: build + 4 części testów end-to-end.
set -e
cd "$(dirname "$0")/../.."
echo "### build"
python3 tracker/build-themes.py
python3 tracker/build-wizard.py
echo
total=0
for part in "" 2 3 4; do
  echo "### testy, część ${part:-1}"
  node "tracker/tests/e2e${part}.mjs" | tail -5
  echo
done
echo "### gotowe"
