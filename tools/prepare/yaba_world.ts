// Generate public/content/worlds/yaba/world.json from the semantic plan + manifest assets (same code as the studio).
import fs from 'node:fs';
import { yabaPlan } from '../../src/world/district/YabaPlan';
import { composeYabaWorld } from '../../src/world/district/YabaWorld';
import type { ContentManifest, WorldDocument } from '../../src/core/types';

(globalThis as { crypto?: Crypto }).crypto ??= (await import('node:crypto')).webcrypto as Crypto;
const man = JSON.parse(fs.readFileSync('public/content/manifest.json', 'utf8')) as ContentManifest;
const bistro = JSON.parse(fs.readFileSync('public/content/worlds/bistro/world.json', 'utf8')) as WorldDocument;
const actor = bistro.entities.find((e) => e.type === 'ACTOR')!;
const doc = composeYabaWorld(yabaPlan(), actor, man.assets);
// bump when the published composition changes; saved copies of an older revision are kept aside by the studio
doc.revision = '2026-10-12.2';
if (doc.district!.missing.length) console.warn('MISSING assets:', doc.district!.missing);
fs.writeFileSync('public/content/worlds/yaba/world.json', JSON.stringify(doc, null, 1));
console.log(`yaba: ${doc.entities.length} entities, ${doc.relations!.length} relations, ${doc.district!.buildings.length} buildings`);
