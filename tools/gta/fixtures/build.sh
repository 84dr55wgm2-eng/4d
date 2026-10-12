#!/usr/bin/env bash
# Rebuild the test package end to end: fixture data → CodeWalker round-trip (canonical XML) → package.
set -euo pipefail
cd "$(dirname "$0")/../../.."
W=tools/gta/work/fixture
CW=tools/gta/cw-extract/bin/Release/net8.0/cw-extract
[ -x "$CW" ] || (tools/gta/fetch-codewalker.sh && dotnet build -c Release tools/gta/cw-extract)
node tools/gta/fixtures/build-fixtures.mjs "$W"
for f in "$W"/xml/*/*.xml; do "$CW" xml-check --in "$f" --out "$f.canon" >/dev/null && mv "$f.canon" "$f"; done
npx tsx tools/gta/pack/build-package.ts --in "$W" --out tools/gta/work/fixture-pkg --id fixture.test-city \
  --name "Ville de test (non GTA)" --source fixture --vehicles fx_car --annotations tools/gta/fixtures/annotations.json
