import * as THREE from 'three';

/**
 * PBR material library for district construction. Texture sets are CC0 Poly Haven scans prepared by
 * tools/acquire (diff/nor/arm WebP). Textures repeat per metre: geometry UVs are written in metres.
 */
export interface MaterialDef {
  /** Poly Haven texture id under content/lagos/materials/<id>/ (omit for plain PBR) */
  tex?: string;
  /** metres covered by one texture tile */
  tile?: number;
  color?: [number, number, number];
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: [number, number, number];
  emissiveIntensity?: number;
  side?: THREE.Side;
  /** surface inside a room: the sky (IBL) reaches it only through openings, so its share is reduced */
  interior?: boolean;
}

/**
 * Share of the sky/environment light (IBL) that reaches surfaces inside rooms. The environment map is global and
 * unoccluded; without this, interiors would be lit like the street and switching the lights off would change little.
 */
export const INTERIOR_ENV = 0.15;

export class MaterialLibrary {
  private loader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private cache = new Map<string, THREE.Material>();
  readonly missing = new Set<string>();
  private interior: THREE.MeshStandardMaterial[] = [];

  /**
   * three.js replaces a material's envMapIntensity by scene.environmentIntensity when the material relies on
   * scene.environment; interior materials therefore point at the environment explicitly so their reduced share holds.
   */
  setEnvironment(env: THREE.Texture | null, sceneIntensity: number) {
    for (const m of this.interior) { m.envMap = env; m.envMapIntensity = INTERIOR_ENV * sceneIntensity; m.needsUpdate = true; }
  }

  constructor(private base: string, private defs: Record<string, MaterialDef>, private anisotropy = 8) {}

  private tex(id: string, map: 'diff' | 'nor' | 'arm', tile: number, srgb: boolean) {
    const key = `${id}/${map}/${tile}`;
    let t = this.textures.get(key);
    if (!t) {
      t = this.loader.load(`${this.base}content/lagos/materials/${id}/${map}.webp`, undefined, undefined, () => this.missing.add(id));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = this.anisotropy;
      t.repeat.set(1 / tile, 1 / tile);
      this.textures.set(key, t);
    }
    return t;
  }

  /** `name` is a key of defs; `tint` multiplies the base colour (paint variants share textures). */
  get(name: string, tint?: [number, number, number]): THREE.Material {
    const key = tint ? `${name}:${tint.join(',')}` : name;
    let m = this.cache.get(key);
    if (m) return m;
    const d = this.defs[name];
    if (!d) throw new Error(`Matière inconnue : ${name}`);
    const std = new THREE.MeshStandardMaterial({
      color: new THREE.Color(...(tint ?? d.color ?? [1, 1, 1])),
      roughness: d.roughness ?? 1,
      metalness: d.metalness ?? 0,
      transparent: d.transparent ?? false,
      opacity: d.opacity ?? 1,
      side: d.side ?? THREE.FrontSide,
    });
    if (d.tex) {
      const tile = d.tile ?? 2;
      std.map = this.tex(d.tex, 'diff', tile, true);
      std.normalMap = this.tex(d.tex, 'nor', tile, false);
      const arm = this.tex(d.tex, 'arm', tile, false);
      std.aoMap = arm; std.roughnessMap = arm; std.metalnessMap = arm;
      std.aoMapIntensity = 0.8;
    }
    if (d.interior) { std.envMapIntensity = INTERIOR_ENV; this.interior.push(std); }
    if (d.emissive) { std.emissive = new THREE.Color(...d.emissive); std.emissiveIntensity = d.emissiveIntensity ?? 1; }
    std.name = key;
    this.cache.set(key, std);
    return std;
  }

  /**
   * Hand-painted signboard texture (canvas): no external font or image dependency.
   * Text is measured, wrapped and fitted to both the width and the height of the board with margins; weathering
   * is seeded from the sign's content so a board always looks the same between reloads.
   */
  sign(text: string, sub: string | undefined, colors: [string, string], aspect: number) {
    const key = `sign:${text}:${sub}:${colors}:${aspect.toFixed(2)}`;
    let m = this.cache.get(key);
    if (m) return m;
    let h = 256, w = Math.round(h * aspect);
    if (w > 2048) { w = 2048; h = Math.max(48, Math.round(w / aspect)); }
    if (w < 128) { w = 128; h = Math.round(w / aspect); }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    const rnd = seeded(key);
    g.fillStyle = colors[0]; g.fillRect(0, 0, w, h);
    // weathering: soft vertical streaks + edge grime, so boards read as painted metal rather than UI
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(40,30,20,${rnd() * 0.06})`;
      g.fillRect(rnd() * w, rnd() * h * 0.5, 2 + rnd() * 10, h * (0.3 + rnd() * 0.7));
    }
    const border = Math.max(4, Math.round(Math.min(w, h) * 0.04));
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = border; g.strokeRect(border / 2, border / 2, w - border, h - border);
    const pad = border + Math.round(Math.min(w, h) * 0.07);
    const boxW = w - pad * 2, boxH = h - pad * 2;
    g.fillStyle = colors[1];
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const font = (size: number, weight: string) => `${weight} ${size}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
    const titleH = sub ? boxH * 0.62 : boxH;
    const title = fitText(g, text, boxW, titleH, '900', font, titleH);
    const subFit = sub ? fitText(g, sub, boxW, boxH - titleH, '700', font, Math.max(10, title.size * 0.55)) : null;
    const draw = (fit: TextFit, top: number, blockH: number, weight: string) => {
      g.font = font(fit.size, weight);
      const lh = fit.size * LINE, total = lh * fit.lines.length;
      fit.lines.forEach((line, i) => g.fillText(line, w / 2, top + (blockH - total) / 2 + lh * (i + 0.5)));
    };
    draw(title, pad, titleH, '900');
    if (subFit) draw(subFit, pad + titleH, boxH - titleH, '700');
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.anisotropy;
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.1 });
    this.cache.set(key, m);
    return m;
  }
}

const LINE = 1.12;
interface TextFit { size: number; lines: string[] }

/** Largest font size (≤ maxSize) whose word-wrapped lines fit inside maxW × maxH; words never get cut. */
export function fitText(g: CanvasRenderingContext2D, str: string, maxW: number, maxH: number, weight: string,
  font: (size: number, weight: string) => string, maxSize: number): TextFit {
  const words = str.split(/\s+/).filter(Boolean);
  for (let size = Math.floor(Math.min(maxSize, maxH / LINE)); size >= 8; size -= 1) {
    g.font = font(size, weight);
    if (words.some((wd) => g.measureText(wd).width > maxW)) continue;
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) {
      const next = cur ? `${cur} ${wd}` : wd;
      if (g.measureText(next).width <= maxW) cur = next;
      else { lines.push(cur); cur = wd; }
    }
    if (cur) lines.push(cur);
    if (lines.length * size * LINE <= maxH) return { size, lines };
  }
  // pathological (single very long word in a tiny box): smallest size, split by characters
  g.font = font(8, weight);
  const lines: string[] = [];
  let cur = '';
  for (const ch of str) { if (g.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch.trimStart(); } else cur += ch; }
  if (cur) lines.push(cur);
  return { size: 8, lines };
}

/** Deterministic PRNG seeded from a string (mulberry32 over an FNV-1a hash). */
export function seeded(seed: string) {
  let a = 2166136261;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 16777619);
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
