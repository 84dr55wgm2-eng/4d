"""Objaverse lane (runs in Actions). objaverseSearch: [terms] -> catalog/objaverse-<term>.json (uid, name, license, faces, likes).
objaverse: [{uid, id}] -> public/content/lagos/models/<id>.glb + provenance. Only cc0 / by licenses accepted."""
import json, sys, os, shutil, re
import objaverse
req = json.load(open(sys.argv[1]))
OK = {'cc0', 'by'}
if req.get('objaverseSearch'):
    ann = objaverse.load_annotations()
    for term in req['objaverseSearch']:
        rx = re.compile(term, re.I)
        hits = []
        for uid, a in ann.items():
            lic = (a.get('license') or '').lower()
            if lic not in OK: continue
            text = a.get('name', '') + ' ' + ' '.join(t['name'] for t in a.get('tags', []))
            if rx.search(text):
                hits.append({'uid': uid, 'n': a.get('name'), 'lic': lic, 'f': a.get('faceCount'), 'likes': a.get('likeCount'), 'views': a.get('viewCount'), 'by': (a.get('user') or {}).get('username'), 'url': a.get('viewerUrl')})
        hits.sort(key=lambda h: -(h['likes'] or 0))
        os.makedirs('tools/acquire/catalog', exist_ok=True)
        json.dump(hits[:120], open(f"tools/acquire/catalog/objaverse-{re.sub('[^a-z0-9]+','_',term.lower())}.json", 'w'), indent=0)
        print('objaverse', term, len(hits))
if req.get('objaverse'):
    uids = [o['uid'] for o in req['objaverse']]
    ann = objaverse.load_annotations(uids)
    paths = objaverse.load_objects(uids=uids, download_processes=4)
    prov_path = 'public/content/lagos/provenance.json'
    prov = json.load(open(prov_path)) if os.path.exists(prov_path) else {}
    for o in req['objaverse']:
        a = ann[o['uid']]
        if (a.get('license') or '').lower() not in OK: print('skip license', o); continue
        os.makedirs('public/content/lagos/raw', exist_ok=True)
        shutil.copy(paths[o['uid']], f"public/content/lagos/raw/{o['id']}.glb")
        prov[f"models/{o['id']}.glb"] = {'source': 'Objaverse / Sketchfab', 'uid': o['uid'], 'name': a.get('name'), 'url': a.get('viewerUrl'), 'license': 'CC0-1.0' if a['license'].lower() == 'cc0' else 'CC-BY-4.0', 'authors': [(a.get('user') or {}).get('username')]}
        print('objaverse got', o['id'], a.get('name'))
    json.dump(prov, open(prov_path, 'w'), indent=1)
