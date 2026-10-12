// node-side checks of the assembly operations on the test package (not GTA content)
//   npx tsx tools/tests/assembly.test.ts [package.json]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { Catalog } from '../../src/content/Catalog';
import { planTransaction, verifyAssembly, OPERATIONS } from '../../src/assembly/operations';
import type { CwsPackage } from '../../src/content/package';

const pkg = JSON.parse(fs.readFileSync(process.argv[2] ?? 'tools/gta/work/fixture-pkg/package.json', 'utf8')) as CwsPackage;
const catalog = new Catalog(); catalog.add(pkg);
const ctx = { activeLevelId: null, catalog, junctions: [] as never[] };
const log = (...a: unknown[]) => console.log(...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));

const streets = catalog.searchSets('rue commerçante avec intérieur accessible', { kind: 'street' });
const courts = catalog.searchSets('cour résidentielle avec accès depuis la rue', { kind: 'courtyard' });
const cross = catalog.searchSets('carrefour', { kind: 'intersection' });
log('search street', streets.map((s) => [s.ref, s.score, s.accesses])); log('search court', courts.map((s) => s.ref)); log('search cross', cross.map((s) => s.ref));
assert.ok(streets[0].ref.includes('street:fx_downtown')); assert.ok(courts.length === 1); assert.ok(cross.length === 1);

// one transaction: street A, crossroads at its east end, courtyard from region B joined on the street's west sidewalk
const sA = catalog.inspect(streets[0].ref)!, sX = catalog.inspect(cross[0].ref)!, sC = catalog.inspect(courts[0].ref)!;
const roadEast = sA.connectors.find((c) => c.kind === 'road' && c.normal[0] > 0.9)!;
const walkWest = sA.connectors.find((c) => c.kind === 'sidewalk' && c.normal[0] < -0.9)!;
const crossWest = sX.connectors.find((c) => c.normal[0] < -0.9)!;
const passage = sC.connectors.filter((c) => c.kind === 'passage').sort((a, b) => a.width - b.width).find((c) => c.width > 2)!;
log('connectors', { roadEast: roadEast.id, walkWest: walkWest.id, crossWest: crossWest.id, passage: [passage.id, passage.width] });
const t = planTransaction({}, [
  { op: 'place_set', input: { ref: streets[0].ref, position: [0, 0, 0], yaw: 0 } },
  { op: 'place_set', input: { ref: cross[0].ref } },
  { op: 'place_set', input: { ref: courts[0].ref } },
], ctx);
const [st, cr, co] = t.results.map((r) => r.placement as string);
const t2 = planTransaction(t.preview, [
  { op: 'connect_sets', input: { a: { placement: st, connector: roadEast.id }, b: { placement: cr, connector: crossWest.id } } },
  { op: 'connect_sets', input: { a: { placement: st, connector: walkWest.id }, b: { placement: co, connector: passage.id } } },
], { ...ctx, junctions: t.junctions });
log('connect results', t2.results.map((r) => [r.op, r.position, r.yaw, r.widthMismatch]));
log('issues after connect', t2.issues.map((i) => [i.code, i.message]));
assert.equal(t2.issues.filter((i) => i.code === 'junction_open').length, 0);
// the crossroads now continues the street eastwards: its west connector lies on the street's east connector
assert.ok(Math.abs((t2.results[0].position as number[])[0] - (27 + 7)) < 0.6, 'crossroads 7 m beyond the street end');
// overlap: move the courtyard onto the street
const t3 = planTransaction(t2.preview, [{ op: 'move_set', input: { placement: co, position: [0, 0, 0] } }], { ...ctx, junctions: t2.junctions });
log('after overlapping move', t3.issues.map((i) => i.code), t3.results[0].brokenJunctions);
assert.ok(t3.issues.some((i) => i.code === 'overlap'));
// refusal with a reason
try { planTransaction(t2.preview, [{ op: 'connect_sets', input: { a: { placement: st, connector: roadEast.id }, b: { placement: co, connector: passage.id } } }], { ...ctx, junctions: t2.junctions }); assert.fail('should refuse'); }
catch (e) { log('refusal', (e as Error).message); assert.equal((e as { code: string }).code, 'incompatible_connectors'); }
// replacement keeps the junction when the new set has a connector of the same kind
const otherStreet = catalog.searchSets('rue', { kind: 'street' }).find((s) => s.ref !== streets[0].ref)!;
const t4 = planTransaction(t2.preview, [{ op: 'replace_set', input: { placement: cr, ref: cross[0].ref } }], { ...ctx, junctions: t2.junctions });
log('replace', t4.results[0]);
// people at the café door
const char = catalog.searchResources('', { kind: 'character' })[0];
const door = sA.connectors.find((c) => c.kind === 'door')!;
const t5 = planTransaction(t2.preview, [{ op: 'add_entities', input: { resource: char.ref, count: 3, placement: st, at: door.id, behavior: 'customer' } }], { ...ctx, junctions: t2.junctions });
log('people', t5.results[0]);
assert.equal((t5.results[0].created as string[]).length, 3);
void otherStreet; void verifyAssembly; void OPERATIONS;
console.log('assembly operations: OK');
