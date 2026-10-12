import { unzipSync } from 'three/examples/jsm/libs/fflate.module.js';

export interface ResourceFile { url: string; filename: string; format?: string; sizeBytes?: number; includes?: { path: string; url: string; sizeBytes?: number }[] }
export interface ResourceManifest { id: string; license?: { name: string; url?: string; attributionRequired?: boolean }; totalBytes?: number; files: ResourceFile[] }
export const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/** Use the provider's actual downloadable format, not a guessed GLB conversion endpoint. */
export async function discoverFiles(id: string, formats: string[] = []): Promise<ResourceManifest> {
  const choices = formats.includes('glb') ? ['glb', 'gltf'] : formats.includes('gltf') ? ['gltf', 'glb'] : ['glb', 'gltf'];
  let error = '';
  for (const format of choices) {
    const res = await fetch(`https://3d.shep.bot/v1/assets/${encodeURIComponent(id)}/files?format=${format}&resolution=1k`, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) { error = `HTTP ${res.status}`; continue; }
    const manifest = await res.json() as ResourceManifest;
    const file = manifest.files?.find((f) => /\.(glb|gltf)(?:\?|$)/i.test(f.filename));
    if (!file) { error = 'Aucun fichier glTF disponible'; continue; }
    if ((file.sizeBytes ?? 0) + (file.includes ?? []).reduce((n, f) => n + (f.sizeBytes ?? 0), 0) > MAX_IMPORT_BYTES)
      throw new Error('Cet asset dépasse le budget de 200 Mo par import');
    return { ...manifest, files: [file] };
  }
  throw new Error(`Aucun téléchargement GLB/glTF utilisable : ${error}`);
}

export function unpackUpload(bytes: ArrayBuffer, filename: string) {
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error('Import limité à 200 Mo');
  const data = new Uint8Array(bytes);
  if (bytes.byteLength >= 4 && new DataView(bytes).getUint32(0, true) === 0x46546c67) return { root: data, resources: {} as Record<string, Uint8Array>, binary: true };
  if (!filename.toLowerCase().endsWith('.zip')) throw new Error('Choisis un GLB ou un ZIP glTF contenant ses textures et son .bin');
  let total = 0;
  const files = unzipSync(data, { filter: (f) => { total += f.originalSize; if (total > MAX_IMPORT_BYTES) throw new Error('Archive décompressée supérieure à 200 Mo'); return true; } });
  const roots = Object.keys(files).filter((name) => /\.(gltf|glb)$/i.test(name));
  if (roots.length !== 1) throw new Error('Le ZIP doit contenir un seul modèle principal GLB ou glTF');
  const path = roots[0], prefix = path.slice(0, path.lastIndexOf('/') + 1);
  const resources: Record<string, Uint8Array> = {};
  for (const [name, file] of Object.entries(files)) {
    if (name.includes('..') || name.startsWith('/')) throw new Error('Chemin invalide dans l’archive');
    if (name.startsWith(prefix)) resources[name.slice(prefix.length)] = file;
  }
  return { root: files[path], resources, binary: path.toLowerCase().endsWith('.glb') };
}

/** Embed companion bytes into a JSON glTF. The normal GLTFLoader then handles the same data
 * in every lane (provider download, ZIP or local upload), with no network URI lost on reload. */
export function embeddedGLTF(root: Uint8Array, resources: Record<string, Uint8Array>): string {
  const doc = JSON.parse(new TextDecoder().decode(root));
  if (doc.asset?.version !== '2.0') throw new Error('Seul glTF 2.0 est accepté');
  const encode = (bytes: Uint8Array, mime: string) => {
    let binary = '';
    for (let i=0; i<bytes.length; i+=32768) binary += String.fromCharCode(...bytes.subarray(i, i+32768));
    return `data:${mime};base64,${btoa(binary)}`;
  };
  for (const object of [...(doc.buffers ?? []), ...(doc.images ?? [])]) {
    if (!object.uri || object.uri.startsWith('data:')) continue;
    const key = decodeURIComponent(object.uri).replace(/^\.\//, '');
    const file = resources[key];
    if (!file) throw new Error(`Dépendance absente : ${key}`);
    const mime = /\.png$/i.test(key) ? 'image/png' : /\.jpe?g$/i.test(key) ? 'image/jpeg' : /\.webp$/i.test(key) ? 'image/webp' : /\.ktx2$/i.test(key) ? 'image/ktx2' : 'application/octet-stream';
    object.uri = encode(file, mime);
  }
  return JSON.stringify(doc);
}
