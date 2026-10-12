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
  /** approximate indirect (floor-bounced) light on surfaces no direct light reaches, e.g. interior ceilings */
  bounce?: number;
}

export class MaterialLibrary {
  private loader = new THREE.TextureLoader();
  private textures = new Map<string, THREE.Texture>();
  private cache = new Map<string, THREE.Material>();
  readonly missing = new Set<string>();

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
    if (d.bounce && std.map) { std.emissiveMap = std.map; std.emissive = std.color.clone().multiplyScalar(d.bounce); }
    if (d.emissive) { std.emissive = new THREE.Color(...d.emissive); std.emissiveIntensity = d.emissiveIntensity ?? 1; }
    std.name = key;
    this.cache.set(key, std);
    return std;
  }

  /** Hand-painted signboard texture (canvas): no external font or image dependency. */
  sign(text: string, sub: string | undefined, colors: [string, string], aspect: number) {
    const key = `sign:${text}:${sub}:${colors}:${aspect.toFixed(2)}`;
    let m = this.cache.get(key);
    if (m) return m;
    const h = 256, w = Math.round(h * aspect);
    const c = document.createElement('canvas');
    c.width = Math.min(2048, w); c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = colors[0]; g.fillRect(0, 0, c.width, h);
    // weathering: soft vertical streaks + edge grime, so boards read as painted metal rather than UI
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(40,30,20,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * c.width, Math.random() * h * 0.5, 2 + Math.random() * 10, h * (0.3 + Math.random() * 0.7));
    }
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 10; g.strokeRect(5, 5, c.width - 10, h - 10);
    g.fillStyle = colors[1];
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fit = (str: string, size: number, y: number, weight: string) => {
      let s = size;
      do { g.font = `${weight} ${s}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`; s -= 4; } while (g.measureText(str).width > c.width * 0.9 && s > 20);
      g.fillText(str, c.width / 2, y);
    };
    if (sub) { fit(text, 120, h * 0.4, '900'); fit(sub, 46, h * 0.8, '700'); }
    else fit(text, 140, h * 0.52, '900');
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.anisotropy;
    m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.75, metalness: 0.1 });
    this.cache.set(key, m);
    return m;
  }
}
