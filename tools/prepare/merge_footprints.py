"""Store measured model bounds (tools/out/footprints.json, from tools/scenarios/footprints.mjs) in the manifest.
Footprints let navigation obstacles be derived from the document alone, whether or not a model is loaded."""
import json
fp = json.load(open('tools/out/footprints.json'))
p = 'public/content/manifest.json'
m = json.load(open(p))
n = 0
for a in m['assets']:
    v = fp.get(a['id'])
    if v and 'error' not in v:
        a['footprint'] = v; n += 1
json.dump(m, open(p, 'w'), indent=1, ensure_ascii=False)
print('footprints stored', n)
