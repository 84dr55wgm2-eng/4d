import * as THREE from 'three';
import type { MaterialDef } from './Materials';

/** Material slots used by DistrictBuilder → CC0 Poly Haven scans (see public/content/lagos/provenance.json). */
export const LAGOS_MATERIALS: Record<string, MaterialDef> = {
  plaster: { tex: 'white_plaster_02', tile: 2.4 },
  plaster_base: { tex: 'dirty_concrete', tile: 1.6 },
  concrete: { tex: 'concrete_wall_004', tile: 2 },
  asphalt: { tex: 'road_damaged', tile: 6, color: [0.82, 0.88, 0.98] },
  drain_slab: { tex: 'concrete_floor_worn_001', tile: 1.4 },
  kerb: { tex: 'dirty_concrete', tile: 1.2 },
  pavers: { tex: 'interlocking_concrete_pavers', tile: 1.6 },
  laterite: { tex: 'red_laterite_soil_stones', tile: 3 },
  floor_tile: { tex: 'terrazzo_tiles', tile: 1.4, interior: true },
  ceiling: { tex: 'white_plaster_02', tile: 2.5, color: [1.3, 1.3, 1.26], interior: true },
  // emulsion-painted interior walls above the dado (cream)
  interior_paint: { tex: 'white_plaster_02', tile: 2, color: [1.42, 1.36, 1.18], interior: true },
  // gloss-painted lower wall (pale blue oil paint): the painted_concrete scan averages green, so it is not used here
  interior_dado: { tex: 'white_plaster_02', tile: 1.6, color: [0.82, 1.08, 1.3], roughness: 0.5, side: THREE.DoubleSide, interior: true },
  interior_wall: { tex: 'grey_plaster', tile: 2 },
  shutter: { tex: 'rusty_metal_shutter', tile: 1.6 },
  roof_metal: { tex: 'rusty_corrugated_iron', tile: 1.5, side: THREE.DoubleSide },
  steel_rusty: { tex: 'rusty_metal_02', tile: 1 },
  steel_painted: { tex: 'rusty_painted_metal', tile: 1.2 },
  steel_dark: { tex: 'metal_plate', tile: 0.6, color: [0.18, 0.18, 0.19] },
  wood_shelf: { tex: 'plywood', tile: 1.2 },
  door_wood: { tex: 'wood_peeling_paint_weathered', tile: 1.2 },
  tank_plastic: { color: [0.05, 0.05, 0.06], roughness: 0.55 },
  ac_unit: { tex: 'rusty_painted_metal', tile: 0.8, color: [0.9, 0.9, 0.86] },
  frame_aluminium: { color: [0.62, 0.63, 0.62], roughness: 0.45, metalness: 0.8 },
  glass_louvre: { color: [0.55, 0.62, 0.62], roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.45, side: THREE.DoubleSide },
  interior_dark: { color: [0.08, 0.08, 0.075], roughness: 1 },
  goods0: { color: [0.75, 0.2, 0.15], roughness: 0.7 },
  goods1: { color: [0.92, 0.82, 0.4], roughness: 0.7 },
  goods2: { color: [0.2, 0.4, 0.7], roughness: 0.6 },
  goods3: { color: [0.85, 0.85, 0.8], roughness: 0.6 },
  cable: { color: [0.03, 0.03, 0.03], roughness: 0.6 },
  fluorescent: { color: [0.95, 0.97, 1], emissive: [0.9, 0.96, 1], emissiveIntensity: 2.2, roughness: 0.3 },
};
