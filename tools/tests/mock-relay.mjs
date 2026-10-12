// TEST PROVIDER — not a model. Speaks the relay protocol (GET /health, POST /v1/turn) with a fixed script of tool
// calls, so the browser agent loop (tool execution on the real studio state, result threading, errors) can be
// verified without model credentials. Its answers are labelled as scripted.
//   PORT=8790 node tools/tests/mock-relay.mjs
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8790);
const turns = [];
// each entry: (lastToolResults) => assistant content
const SCRIPT = [
  () => [{ type: 'text', text: '[fournisseur de test scripté] Recherche des ensembles.' }, { type: 'tool_use', id: 't1', name: 'search_sets', input: { query: 'cour résidentielle', kind: 'courtyard' } }, { type: 'tool_use', id: 't2', name: 'search_sets', input: { query: 'rue', kind: 'street' } }],
  (r) => {
    const court = JSON.parse(r.t1)[0].ref, street = JSON.parse(r.t2).find((s) => !/downtown/.test(s.ref))?.ref ?? JSON.parse(r.t2)[0].ref;
    return [{ type: 'tool_use', id: 't3', name: 'inspect_set', input: { ref: court } }, { type: 'tool_use', id: 't4', name: 'inspect_set', input: { ref: street } }];
  },
  (r) => {
    const court = JSON.parse(r.t3), street = JSON.parse(r.t4);
    const passage = court.connectors.filter((c) => c.kind === 'passage' && c.width > 2).sort((a, b) => a.width - b.width)[0];
    const walk = street.connectors.find((c) => c.kind === 'sidewalk' && c.normal[0] < -0.9);
    return [{ type: 'tool_use', id: 't5', name: 'apply_plan', input: { label: 'Cour avec accès depuis la rue (agent de test)', steps: [
      { op: 'place_set', input: { ref: street.ref, position: [0, 0, 60], yaw: 0 } },
      { op: 'place_set', input: { ref: court.ref } },
      { op: 'connect_sets', input: { a: { placement: '$0', connector: walk.id }, b: { placement: '$1', connector: passage.id } } },
    ] } }];
  },
  () => [{ type: 'tool_use', id: 't6', name: 'connect_sets', input: { a: { placement: 'does_not_exist', connector: 'x' }, b: { placement: 'nor_this', connector: 'y' } } }],
  () => [{ type: 'tool_use', id: 't7', name: 'verify', input: {} }],
  () => [{ type: 'text', text: '[fournisseur de test scripté] Terminé.' }],
];

const send = (res, s, b) => { res.writeHead(s, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type' }); res.end(JSON.stringify(b)); };
http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.url === '/health') return send(res, 200, { ok: true, provider: 'scripted-test', model: 'scripted-test (pas un modèle)', configured: true, missing: [] });
  if (req.url === '/v1/turn' && req.method === 'POST') {
    let body = ''; for await (const c of req) body += c;
    const b = JSON.parse(body);
    const last = b.messages.at(-1);
    const results = {};
    if (Array.isArray(last.content)) for (const x of last.content) if (x.type === 'tool_result') results[x.tool_use_id] = x.content;
    if (typeof last.content === 'string') turns.length = 0;
    const i = turns.length; turns.push(results);
    const content = (SCRIPT[i] ?? SCRIPT.at(-1))(results);
    console.log('turn', i, Object.keys(results).map((k) => `${k}:${results[k].slice(0, 100)}`).join(' | '));
    return send(res, 200, { id: `mock_${i}`, model: 'scripted-test', content, stop_reason: content.some((c) => c.type === 'tool_use') ? 'tool_use' : 'end_turn' });
  }
  send(res, 404, {});
}).listen(PORT, () => console.log(`mock relay (scripted test provider) on ${PORT}`));
