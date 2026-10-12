# Resume state

_Last pass: 2026-10-12 — Yaba, Lagos 2003._

## Works in the product (verified by driving the real app, pass 3)
- `?world=yaba`: street with stocked shops (shelving and goods by trade), accessible cybercafé (6 stations with
  sockets and power leads, light switch, fans, counter, notices), automatic follow framing outside and inside.
- Tap actor → tap destination; door → Ouvrir; chair → S'asseoir. Lights switch without shader recompiles.
- Creator: brief → reading (place/era/constraints/unsupported) → needs (mandatory vs alternatives) → parameters
  (street, café side/position/size, stations, layout, storeys) with a top view → composed world.
- Commands (deterministic parser, not an LLM) and undo. Sequences: reference scene or new; actions editable; play,
  stop (stops the walk), seek, re-time when stale, WebM/MP4 export (WebCodecs).

## Known limits
- No Lagos-specific building pack: architecture is semantic construction + CC0 scans. No danfo/okada/market/extras.
- Generated streets reuse the same kit and fictional signs; only the café room is enterable.
- Interior light is still an approximation (one bank light + fill, reduced sky share), no baked GI.
- Software-GL boot in the test harness is several minutes (shader compiles); no real-device measurements.

## Next actions
- Danfo/okada/market content via the acquisition workflow; pedestrians.
- Per-room light probes; camera moves (not only cuts) in sequences; LLM via a server relay calling the same tools.
