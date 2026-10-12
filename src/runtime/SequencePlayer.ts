import * as THREE from 'three';
import { Emitter, uid } from '../core/emitter';
import type { Sequence, SequenceBeat, SequenceStart, Transform, Vec3 } from '../core/types';
import type { Studio } from './Studio';

/**
 * Actions and cameras on one directing clock.
 * - start state is captured data (actor pose + every entity the beats touch), so every play/seek/export
 *   begins from the same world: no accumulated walks or doors opened twice;
 * - rehearse() runs the beats in fixed-step simulation and measures when each beat starts — cuts are
 *   anchored to beats, so timing stays correct when an action gets longer or shorter;
 * - export() renders frames at a fixed step (reproducible) and encodes them with WebCodecs.
 */
type Events = { tick: { time: number; duration: number; playing: boolean; beat: number } };

export class SequencePlayer extends Emitter<Events> {
  seq: Sequence | null = null;
  playing = false;
  time = 0;
  beat = -1;
  private token = 0;
  private waits: { at: number; resolve: () => void }[] = [];
  private lastCut = '';

  constructor(private studio: Studio) {
    super();
    studio.engine.onUpdate((dt) => this.tick(dt));
  }

  // ------------------------------------------------------------ authoring
  /** Start state from the current world: the actor and every entity referenced by the beats. */
  captureStart(beats: SequenceBeat[]): SequenceStart {
    const s = this.studio, a = s.actor!;
    const ids = new Set(beats.flatMap((b) => (b.target ? [b.target] : [])));
    const doc = s.store.doc;
    // relations pull in the seats of a workstation, etc.
    for (const r of doc.relations ?? []) if (ids.has(r.to)) ids.add(r.from);
    const seatedOn = doc.entities.find((e) => (e.metadata?.interaction as { occupiedBy?: string })?.occupiedBy === s.actorEntityId)?.id ?? null;
    if (seatedOn) ids.add(seatedOn);
    const entities: SequenceStart['entities'] = {};
    for (const id of ids) {
      const e = s.store.entity(id);
      if (e) entities[id] = { transform: structuredClone(e.transform), interaction: structuredClone((e.metadata?.interaction ?? undefined) as Record<string, unknown> | undefined) };
    }
    return { actor: { position: a.position.toArray() as Vec3, heading: a.heading, seatedOn }, entities };
  }

  create(name: string, beats: SequenceBeat[], cuts: Sequence['cuts'] = []): Sequence {
    return { id: uid('seq'), name, beats, cuts, start: this.captureStart(beats) };
  }

  /** Restore the start state (data first, then the actor). */
  restore(seq: Sequence) {
    const s = this.studio, a = s.actor!;
    this.token++;
    this.waits = [];
    a.cancelPath();
    s.store.applySilently(`Début de ${seq.name}`, (doc) => {
      for (const [id, st] of Object.entries(seq.start.entities)) {
        const e = doc.entities.find((x) => x.id === id);
        if (!e) continue;
        e.transform = structuredClone(st.transform) as Transform;
        if (st.interaction) (e.metadata ??= {}).interaction = structuredClone(st.interaction);
      }
      // the actor is never left marked as seated/holding something that the start state does not say
      for (const e of doc.entities) {
        const inter = e.metadata?.interaction as Record<string, unknown> | undefined;
        if (!inter) continue;
        if (inter.occupiedBy === s.actorEntityId && e.id !== seq.start.actor.seatedOn) inter.occupiedBy = null;
      }
    });
    a.place(new THREE.Vector3(...seq.start.actor.position), seq.start.actor.heading);
    if (seq.start.actor.seatedOn) s.interactions.restoreSeat();
    this.time = 0;
    this.beat = -1;
    this.lastCut = '';
    s.entities.sync(s.store.doc);
  }

  // ------------------------------------------------------------ timeline
  cutTimes(seq: Sequence) {
    const starts = seq.timing?.beatStarts ?? [];
    return seq.cuts.map((c) => ({ ...c, at: (starts[c.beat] ?? 0) + c.offset })).sort((x, y) => x.at - y.at);
  }

  private applyCut(seq: Sequence, t: number, instant = false) {
    const cuts = this.cutTimes(seq);
    let current: (typeof cuts)[number] | undefined;
    for (const c of cuts) if (c.at <= t + 1e-6) current = c;
    if (!current || current.id === this.lastCut) return;
    this.lastCut = current.id;
    const s = this.studio;
    if (current.shotId === 'follow') {
      s.cameras.setMode('follow');
      s.resetFollowCamera();
      return;
    }
    const shot = s.store.doc.shots.find((x) => x.id === current!.shotId);
    if (!shot) return;
    s.cameras.goTo(shot, instant ? 0 : 0); // cuts, not moves: a sequence edits between shots
    s.cameras.trackTarget = !!shot.lookAtEntity;
  }

  private tick(dt: number) {
    if (!this.playing || !this.seq) return;
    this.time += dt;
    for (const w of this.waits.filter((x) => x.at <= this.time)) w.resolve();
    this.waits = this.waits.filter((x) => x.at > this.time);
    this.applyCut(this.seq, this.time);
    this.emit('tick', { time: this.time, duration: this.seq.timing?.duration ?? 0, playing: this.playing, beat: this.beat });
  }

  private wait(seconds: number, token: number) {
    return new Promise<void>((resolve) => this.waits.push({ at: this.time + seconds, resolve: () => token === this.token && resolve() }));
  }

  private async runBeats(seq: Sequence, token: number, starts?: number[]) {
    const s = this.studio;
    for (let i = 0; i < seq.beats.length; i++) {
      if (token !== this.token) return false;
      this.beat = i;
      starts?.push(this.time);
      const b = seq.beats[i];
      let r: { ok: boolean; error?: string } = { ok: true };
      if (b.kind === 'moveTo' && b.position) r = await s.ops.moveActorTo(b.position);
      else if (b.kind === 'interact' && b.target) r = await s.interactions.execute(b.target, b.action);
      else if (b.kind === 'turnTo' && b.position) { s.ops.turnActorTo(b.position); await this.wait(0.8, token); }
      else if (b.kind === 'wait') await this.wait(b.seconds ?? 1, token);
      if (token !== this.token) return false;
      if (!r.ok) throw new Error(`« ${b.label} » : ${r.error}`);
      await this.wait(0.35, token); // breath between beats
    }
    return true;
  }

  /** Fixed-step run of the whole sequence; records beat start times. Leaves the world at the start state. */
  async rehearse(seq: Sequence, dt = 1 / 30) {
    const s = this.studio, e = s.engine;
    const wasPaused = e.paused;
    e.paused = true;
    this.restore(seq);
    const token = this.token;
    const starts: number[] = [];
    let done = false, failed: unknown = null;
    this.seq = seq;
    this.playing = true;
    this.runBeats(seq, token, starts).then(() => (done = true), (err) => { failed = err; done = true; });
    let guard = 0;
    while (!done && guard++ < 60 * 30 * 4) {
      e.step(dt, dt);
      await Promise.resolve(); await Promise.resolve();
    }
    this.playing = false;
    const duration = this.time + 1.5;
    this.restore(seq);
    e.paused = wasPaused;
    if (failed) throw failed;
    if (!done) throw new Error('La séquence ne se termine pas (plus de 4 minutes)');
    seq.timing = { beatStarts: starts, duration, dt };
    return seq.timing;
  }

  play(seq: Sequence) {
    this.stop();
    this.restore(seq);
    this.seq = seq;
    this.playing = true;
    const token = this.token;
    this.studio.set({ mode: 'direct' });
    this.applyCut(seq, 0, true);
    this.runBeats(seq, token).then(
      () => this.wait(1.2, token).then(() => token === this.token && this.stop()),
      (err) => { if (token === this.token) { this.stop(); this.studio.toast(String(err instanceof Error ? err.message : err)); } },
    );
  }

  stop() {
    this.token++;
    this.playing = false;
    this.waits = [];
    this.emit('tick', { time: this.time, duration: this.seq?.timing?.duration ?? 0, playing: false, beat: this.beat });
  }

  /** Jump to time t: restore and re-simulate (same result as playing up to t). */
  async seek(seq: Sequence, t: number, dt = 1 / 30) {
    const e = this.studio.engine;
    this.stop();
    const wasPaused = e.paused;
    e.paused = true;
    this.restore(seq);
    this.seq = seq;
    this.playing = true;
    const token = this.token;
    this.runBeats(seq, token).catch(() => {});
    while (this.time < t) { e.step(dt, dt); await Promise.resolve(); await Promise.resolve(); }
    this.applyCut(seq, this.time, true);
    this.playing = false;
    this.token++;
    e.renderOnce();
    e.paused = wasPaused;
  }

  /** Reproducible render: fixed step, every frame encoded with its exact timestamp. */
  async export(seq: Sequence, opts: { fps?: number; width?: number; onProgress?: (f: number) => void } = {}): Promise<{ blob: Blob; mime: string; frames: number }> {
    if (!('VideoEncoder' in window)) throw new Error('Export vidéo indisponible : ce navigateur n’a pas WebCodecs (VideoEncoder).');
    if (!seq.timing) await this.rehearse(seq);
    const fps = opts.fps ?? 30, dt = 1 / fps;
    const s = this.studio, e = s.engine, canvas = e.canvas;
    const width = Math.min(opts.width ?? 1280, canvas.width) & ~1, height = Math.round((width * canvas.height) / canvas.width) & ~1;
    const { container, encoder, finish } = await createEncoder(width, height, fps);
    const off = new OffscreenCanvas(width, height), ctx = off.getContext('2d')!;
    const total = Math.ceil(seq.timing!.duration * fps);
    const wasPaused = e.paused;
    e.paused = true;
    this.restore(seq);
    this.seq = seq;
    this.playing = true;
    const token = this.token;
    this.runBeats(seq, token).catch(() => {});
    try {
      for (let f = 0; f < total; f++) {
        if (f > 0) { e.step(dt, dt); await Promise.resolve(); await Promise.resolve(); }
        this.applyCut(seq, this.time, true);
        e.renderOnce();
        ctx.drawImage(canvas, 0, 0, width, height);
        const frame = new VideoFrame(off, { timestamp: Math.round((f * 1e6) / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: f % (fps * 2) === 0 });
        frame.close();
        if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
        opts.onProgress?.((f + 1) / total);
      }
      const blob = await finish();
      return { blob, mime: container === 'mp4' ? 'video/mp4' : 'video/webm', frames: total };
    } finally {
      this.playing = false;
      this.token++;
      this.restore(seq);
      e.paused = wasPaused;
    }
  }
}

async function createEncoder(width: number, height: number, fps: number) {
  const candidates: { codec: string; container: 'mp4' | 'webm' }[] = [
    { codec: 'avc1.4d0028', container: 'mp4' },
    { codec: 'vp09.00.31.08', container: 'webm' },
    { codec: 'vp8', container: 'webm' },
  ];
  for (const c of candidates) {
    const config: VideoEncoderConfig = { codec: c.codec, width, height, bitrate: 6_000_000, framerate: fps };
    const support = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (!support.supported) continue;
    if (c.container === 'mp4') {
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, fastStart: 'in-memory' });
      const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => console.error(e) });
      encoder.configure(config);
      return { container: c.container, encoder, finish: async () => { await encoder.flush(); muxer.finalize(); return new Blob([target.buffer], { type: 'video/mp4' }); } };
    }
    const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: c.codec === 'vp8' ? 'V_VP8' : 'V_VP9', width, height, frameRate: fps } });
    const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => console.error(e) });
    encoder.configure(config);
    return { container: c.container, encoder, finish: async () => { await encoder.flush(); muxer.finalize(); return new Blob([target.buffer], { type: 'video/webm' }); } };
  }
  throw new Error('Aucun encodeur vidéo (H.264, VP9, VP8) disponible dans ce navigateur.');
}
