"""Bistro prep stage 1: KHR_materials_pbrSpecularGlossiness + BC7 DDS  ->  metal/rough glTF with PNG/JPG textures.

Usage: python3 -I bistro_materials.py <src_dir_with_bistro.gltf_and_dds> <out_dir> [max_size]

Lumberyard conventions (observed in the data): *_diff = albedo (sRGB, alpha = opacity),
*_ddna = tangent normal (RGB) + gloss (A), *_spec = specular colour (sRGB; ~56 = 0.04 linear dielectric).
"""
import json, os, sys, hashlib
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
MAX = int(sys.argv[3]) if len(sys.argv) > 3 else 1024
g = json.load(open(os.path.join(src, 'bistro.gltf')))
os.makedirs(os.path.join(out, 'tex'), exist_ok=True)
cache_img = {}

def load(uri):
    if uri not in cache_img:
        im = Image.open(os.path.join(src, uri)).convert('RGBA')
        if max(im.size) > MAX:
            s = MAX / max(im.size)
            im = im.resize((max(4, int(im.size[0] * s)), max(4, int(im.size[1] * s))), Image.LANCZOS)
        cache_img[uri] = np.asarray(im).astype(np.float32) / 255.0
    return cache_img[uri]

def srgb_to_lin(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def resize_to(a, shape):
    if a.shape[:2] == shape: return a
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(im.resize((shape[1], shape[0]), Image.BILINEAR)).astype(np.float32) / 255.0

new_images, new_textures, img_index = [], [], {}
norm_srcs, missing = {}, []
def add_image(key, arr, alpha):
    if key in img_index: return img_index[key]
    name = hashlib.md5(key.encode()).hexdigest()[:12]
    a8 = (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
    if alpha:
        fn = f'tex/{name}.png'; Image.fromarray(a8, 'RGBA').save(os.path.join(out, fn), optimize=False, compress_level=1)
    else:
        fn = f'tex/{name}.png'; Image.fromarray(a8[..., :3], 'RGB').save(os.path.join(out, fn), compress_level=1)
    new_images.append({'uri': fn}); new_textures.append({'source': len(new_images) - 1, 'sampler': 0})
    img_index[key] = len(new_textures) - 1
    return img_index[key]

def dds_uri(tinfo):
    t = g['textures'][tinfo['index']]
    ext = t.get('extensions', {}).get('MSFT_texture_dds')
    uri = g['images'][ext['source'] if ext else t['source']]['uri']
    if not uri.endswith('.dds'): uri = uri.rsplit('.', 1)[0] + '.dds'
    return uri if os.path.exists(os.path.join(src, uri)) else None

for m in g['materials']:
    sg = m.get('extensions', {}).pop('KHR_materials_pbrSpecularGlossiness', None)
    if 'emissiveTexture' in m:
        u = dds_uri(m['emissiveTexture'])
        if u: m['emissiveTexture'] = {'index': add_image('E:' + u, load(u), False)}; m.setdefault('emissiveFactor', [1, 1, 1])
        else: m.pop('emissiveTexture'); missing.append(m['name'])
    if 'normalTexture' in m:
        u = dds_uri(m['normalTexture'])
        if u:
            n = load(u).copy(); norm_srcs[m['name']] = u; n[..., 3] = 1
            m['normalTexture'] = {'index': add_image('N:' + u, n, False)}
        else: m.pop('normalTexture'); missing.append(m['name'])
    if sg is None:
        continue
    pbr = {}
    dfac = sg.get('diffuseFactor', [1, 1, 1, 1]); sfac = sg.get('specularFactor', [1, 1, 1]); gfac = sg.get('glossinessFactor', 1.0)
    blended = m.get('alphaMode', 'OPAQUE') != 'OPAQUE'
    diff_u = dds_uri(sg['diffuseTexture']) if 'diffuseTexture' in sg else None
    spec_u = dds_uri(sg['specularGlossinessTexture']) if 'specularGlossinessTexture' in sg else None
    # gloss lives in the alpha of the normal map (ddna)
    norm_src = norm_srcs.get(m['name']) if 'normalTexture' in m else None
    base = load(diff_u) if diff_u else None
    shape = base.shape[:2] if base is not None else (load(norm_src).shape[:2] if norm_src else (4, 4))
    spec = resize_to(load(spec_u), shape)[..., :3] if spec_u else np.ones(shape + (3,), np.float32)
    spec_lin = srgb_to_lin(spec) * np.array(sfac, np.float32)
    gloss = resize_to(load(norm_src), shape)[..., 3] if norm_src else np.ones(shape, np.float32)
    rough = np.clip(1.0 - gloss * gfac, 0.04, 1.0)
    smax = spec_lin.max(axis=-1)
    metal = np.clip((smax - 0.12) / (0.45 - 0.12), 0, 1)
    if spec_u or norm_src:
        mr = np.stack([np.ones(shape), rough, metal, np.ones(shape)], -1).astype(np.float32)
        key = f'MR:{spec_u}:{norm_src}:{gfac:.3f}:{sfac}'
        pbr['metallicRoughnessTexture'] = {'index': add_image(key, mr, False)}
        pbr['metallicFactor'] = 1.0; pbr['roughnessFactor'] = 1.0
    else:
        pbr['metallicFactor'] = float(np.clip((max(sfac) - 0.12) / 0.33, 0, 1)); pbr['roughnessFactor'] = float(np.clip(1 - gfac, 0.04, 1))
    if base is not None:
        b = base.copy()
        if metal.max() > 0.01:
            # metals: albedo comes from specular colour (stored back to sRGB)
            spec_srgb = np.clip(spec_lin, 0, 1) ** (1 / 2.2)
            b[..., :3] = b[..., :3] * (1 - metal[..., None]) + spec_srgb * metal[..., None]
        if not blended: b[..., 3] = 1
        key = f'B:{diff_u}:{spec_u if metal.max() > 0.01 else ""}:{sfac}:{blended}'
        pbr['baseColorTexture'] = {'index': add_image(key, b, blended)}
    pbr['baseColorFactor'] = dfac
    m['pbrMetallicRoughness'] = pbr
    if not m.get('extensions'): m.pop('extensions', None)

g['images'] = new_images; g['textures'] = new_textures; g['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
g['extensionsUsed'] = [e for e in g.get('extensionsUsed', []) if e not in ('KHR_materials_pbrSpecularGlossiness', 'MSFT_texture_dds')]
g.pop('extensionsRequired', None)
g['buffers'][0]['uri'] = os.path.relpath(os.path.join(src, 'bistro.bin'), out)
json.dump(g, open(os.path.join(out, 'bistro_mr.gltf'), 'w'))
print('missing tex on', len(missing), missing[:10]); print('materials', len(g['materials']), 'images', len(new_images))
