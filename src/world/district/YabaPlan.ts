import type { BuildingSpec, DistrictParams, DistrictPlan, Opening, Trade } from '../../core/types';
import { seeded } from './Materials';

/**
 * Yaba, Lagos — c. 2003. A fictional block of a Yaba commercial street (no real business names):
 * two- and three-storey rendered concrete buildings with parapet roofs, louvre windows behind burglar-proof
 * bars, ground-floor shops with roll-up shutters and corrugated awnings, painted signboards, covered drains,
 * laterite shoulders and paved walkways. The cybercafé is the one accessible interior of this pass.
 *
 * Street runs along X. South-side fronts face +Z (yaw 0), north-side fronts face −Z (yaw 180).
 */
export const STREET = { length: 76, carriageway: 7, sidewalk: 3.2, drain: true };
const FRONT_Z = STREET.carriageway / 2 + 0.7 + STREET.sidewalk; // 7.4 m from the centre line

const PAINT: Record<string, [number, number, number]> = {
  cream: [0.93, 0.87, 0.72], ochre: [0.86, 0.66, 0.38], mint: [0.68, 0.84, 0.72], sky: [0.62, 0.78, 0.88],
  rose: [0.9, 0.7, 0.68], lemon: [0.94, 0.86, 0.5], white: [0.92, 0.91, 0.87], sand: [0.8, 0.72, 0.58], green: [0.5, 0.7, 0.52],
};

let n = 0;
const op = (kind: Opening['kind'], wall: Opening['wall'], offset: number, width: number, height: number, level: number, sill?: number): Opening =>
  ({ id: `op${n++}`, kind, wall, offset, width, height, level, sill });

/** Standard Yaba shop-house: shop fronts below, louvre windows above. */
function shopHouse(id: string, name: string, x: number, side: 1 | -1, width: number, depth: number, floors: number, paint: keyof typeof PAINT,
  shops: { offset: number; width: number }[], sign?: BuildingSpec['signs'][number], extra: Partial<BuildingSpec['style']> = {}, trade: Trade = 'general', frontZ = FRONT_Z): BuildingSpec {
  const openings: Opening[] = shops.map((s) => ({ ...op('shopfront', 'front', s.offset, s.width, 2.6, 0), trade }));
  for (let f = 1; f < floors; f++) {
    const count = Math.max(1, Math.floor(width / 3.2));
    for (let i = 0; i < count; i++) openings.push(op('window', 'front', -width / 2 + (i + 0.5) * (width / count), 1.5, 1.35, f, 0.95));
    openings.push(op('window', 'left', -depth / 2 + 2.5, 1.2, 1.2, f, 1.0));
    openings.push(op('window', 'back', 0, 1.4, 1.2, f, 1.0));
  }
  return {
    id, name, front: [x, 0.15, side * frontZ], yaw: side === 1 ? 180 : 0, width, depth, floors, floorHeight: 3.2,
    style: { wall: 'plaster', trim: 'concrete', paint: PAINT[paint], roof: 'parapet', balcony: floors > 1 && width > 7, louvres: true, bars: true, ...extra },
    openings, rooms: [], signs: sign ? [sign] : [],
  };
}

export function yabaPlan(): DistrictPlan {
  n = 0;
  const south: BuildingSpec[] = [
    shopHouse('b.s1', 'Immeuble Adeyemi', -30, -1, 9, 10, 2, 'ochre', [{ offset: -2, width: 3 }, { offset: 2.2, width: 2.6 }],
      { text: 'MAMA BISI PROVISIONS', sub: 'Beverages • Provisions • Toiletries', colors: ['#f3e2a6', '#8b1a12'], level: 0, kind: 'board' }, {}, 'provisions'),
    shopHouse('b.s2', 'Immeuble Okafor', -19.6, -1, 10.5, 11, 3, 'sky', [{ offset: -2.6, width: 3.2 }, { offset: 2.4, width: 3 }],
      { text: 'GLORY GSM CENTRE', sub: 'Phones • Recharge Cards • Accessories', colors: ['#14427a', '#ffd23f'], level: 0, kind: 'board' }, {}, 'phones'),
  ];
  // the cybercafé building: door + two barred display windows below, office floor above
  const cafe: BuildingSpec = {
    id: 'b.cafe', name: 'Immeuble du cybercafé', front: [-6.6, 0.15, -FRONT_Z], yaw: 0, width: 12, depth: 11, floors: 2, floorHeight: 3.4,
    style: { wall: 'plaster', trim: 'concrete', paint: PAINT.cream, base: [0.33, 0.36, 0.42], roof: 'parapet', balcony: true, louvres: true, bars: true },
    openings: [
      op('door', 'front', -3.9, 1.25, 2.25, 0),
      op('window', 'front', -0.6, 2.4, 1.45, 0, 0.95),
      op('window', 'front', 3.2, 2.4, 1.45, 0, 0.95),
      op('window', 'front', -3.6, 1.5, 1.35, 1, 0.95), op('window', 'front', 0, 1.5, 1.35, 1, 0.95), op('window', 'front', 3.6, 1.5, 1.35, 1, 0.95),
      op('window', 'left', -6.5, 1.4, 1.2, 1, 1.0), op('window', 'back', 0, 1.4, 1.2, 1, 1.0),
    ],
    rooms: [{ id: 'room.cafe', name: 'Cybercafé', kind: 'cybercafe', level: 0, rect: [-5.75, -10.75, 5.75, -0.25] }],
    signs: [
      { text: 'NETLINK CYBER CAFÉ', sub: 'Browsing ₦150/hr • Printing • Scanning • E-mail', colors: ['#0d3b66', '#f4f1de'], level: 0, kind: 'board' },
      { text: 'CYBER', sub: 'OPEN 24HRS', colors: ['#e63946', '#ffffff'], level: 0, kind: 'blade' },
    ],
  };
  south.push(cafe);
  south.push(
    shopHouse('b.s4', 'Immeuble Bello', 5.8, -1, 8.6, 10, 2, 'mint', [{ offset: 0, width: 3.6 }],
      { text: 'DIVINE FAVOUR CHEMIST', sub: 'Patent Medicine Store', colors: ['#ffffff', '#1b7a3a'], level: 0, kind: 'board' }, {}, 'chemist'),
    shopHouse('b.s5', 'Immeuble Eze', 15.6, -1, 10, 10, 3, 'rose', [{ offset: -2.5, width: 3 }, { offset: 2.4, width: 3 }],
      { text: 'BLESSED HANDS BUSINESS CENTRE', sub: 'Typing • Photocopy • Lamination • Binding', colors: ['#fff4d6', '#202060'], level: 0, kind: 'board' }, {}, 'business'),
    shopHouse('b.s6', 'Immeuble Lawal', 26, -1, 9.4, 9, 2, 'lemon', [{ offset: -1.8, width: 2.8 }, { offset: 2.3, width: 2.4 }],
      { text: 'ADE & SONS ELECTRICALS', sub: 'Wiring • Bulbs • Stabilizers', colors: ['#1d1d1d', '#ffcc00'], level: 0, kind: 'board' }, {}, 'electricals'),
  );
  const north: BuildingSpec[] = [
    shopHouse('b.n1', 'Immeuble Ogun', -28.5, 1, 12, 10, 3, 'white', [{ offset: -3, width: 3.4 }, { offset: 2.6, width: 3.4 }],
      { text: 'KINGSWAY FASHION HOUSE', sub: 'Tailoring • Aso-Ebi • Alterations', colors: ['#5a189a', '#fde68a'], level: 0, kind: 'board' }, {}, 'fashion'),
    shopHouse('b.n2', 'Immeuble Adebayo', -16.4, 1, 10, 10, 2, 'green', [{ offset: 0, width: 3.8 }],
      { text: 'TUNDE BARBING SALOON', sub: 'Unisex • Low cut • Shaving', colors: ['#f8f9fa', '#c1121f'], level: 0, kind: 'board' }, {}, 'barber'),
    shopHouse('b.n3', 'Immeuble Nwosu', -5.2, 1, 10.5, 11, 3, 'sand', [{ offset: -2.6, width: 3 }, { offset: 2.5, width: 3 }],
      { text: 'UNITY PHOTO STUDIO', sub: 'Passport Photos in 10 Minutes', colors: ['#003049', '#fcbf49'], level: 0, kind: 'board' }, {}, 'photo'),
    shopHouse('b.n4', 'Immeuble Bakare', 6.4, 1, 10, 10, 2, 'ochre', [{ offset: -2.4, width: 3 }, { offset: 2.4, width: 2.8 }],
      { text: 'MAMA PUT CANTEEN', sub: 'Jollof • Moi-moi • Chilled Drinks', colors: ['#f77f00', '#ffffff'], level: 0, kind: 'board' }, {}, 'canteen'),
    shopHouse('b.n5', 'Immeuble Ibe', 17.6, 1, 10.5, 10, 3, 'sky', [{ offset: 0, width: 4 }],
      { text: 'YABA BOOKS & STATIONERY', sub: 'JAMB • WAEC • Textbooks', colors: ['#fefae0', '#283618'], level: 0, kind: 'board' }, {}, 'books'),
    shopHouse('b.n6', 'Immeuble Danjuma', 28.4, 1, 9.6, 9, 2, 'cream', [{ offset: -2, width: 2.8 }, { offset: 2.2, width: 2.6 }]),
  ];
  // street ends: buildings across the far junctions close the vista (fond de rue)
  const endE: BuildingSpec = { ...shopHouse('b.e', 'Immeuble du carrefour', 40, -1, 26, 9, 3, 'mint', [{ offset: -7, width: 3.4 }, { offset: 0, width: 3.4 }, { offset: 7, width: 3.4 }],
    { text: 'ADUNNI PLAZA', sub: 'Shops • Offices to Let', colors: ['#264653', '#e9c46a'], level: 1, kind: 'painted' }), front: [42, 0.15, 0], yaw: -90 };
  const endW: BuildingSpec = { ...shopHouse('b.w', 'Immeuble ouest', -40, -1, 26, 9, 2, 'rose', [{ offset: -6, width: 3.4 }, { offset: 6, width: 3.4 }],
    { text: 'GOD’S TIME IS THE BEST VENTURES', colors: ['#fff', '#7b2cbf'], level: 1, kind: 'painted' }), front: [-42, 0.15, 0], yaw: 90 };
  return {
    brief: { place: 'Yaba, Lagos', era: '2003', mood: 'fin de matinée, rue commerçante animée', text: 'Rue commerçante de Yaba (Lagos) vers 2003, avec un cybercafé accessible.' },
    street: STREET,
    buildings: [...south, ...north, endE, endW],
    requires: [],
    missing: [],
  };
}

export const CAFE = { building: 'b.cafe', room: 'room.cafe' };

// ---------------------------------------------------------------- parametric generation (creator)
/** Fictional shop identities per trade (no real business names). */
const SHOP_NAMES: Record<Trade, { text: string; sub: string; colors: [string, string] }[]> = {
  provisions: [{ text: 'MAMA BISI PROVISIONS', sub: 'Beverages • Provisions • Toiletries', colors: ['#f3e2a6', '#8b1a12'] }, { text: 'IYA KEMI STORES', sub: 'Provisions • Soft Drinks', colors: ['#fff3b0', '#335c67'] }],
  phones: [{ text: 'GLORY GSM CENTRE', sub: 'Phones • Recharge Cards • Accessories', colors: ['#14427a', '#ffd23f'] }, { text: 'FAVOUR TELECOM', sub: 'Recharge Cards • Phone Repairs', colors: ['#1d3557', '#f1faee'] }],
  chemist: [{ text: 'DIVINE FAVOUR CHEMIST', sub: 'Patent Medicine Store', colors: ['#ffffff', '#1b7a3a'] }, { text: 'GOODHEALTH CHEMIST', sub: 'Drugs • Toiletries', colors: ['#f8f9fa', '#2a9d8f'] }],
  business: [{ text: 'BLESSED HANDS BUSINESS CENTRE', sub: 'Typing • Photocopy • Lamination • Binding', colors: ['#fff4d6', '#202060'] }],
  electricals: [{ text: 'ADE & SONS ELECTRICALS', sub: 'Wiring • Bulbs • Stabilizers', colors: ['#1d1d1d', '#ffcc00'] }],
  fashion: [{ text: 'KINGSWAY FASHION HOUSE', sub: 'Tailoring • Aso-Ebi • Alterations', colors: ['#5a189a', '#fde68a'] }],
  barber: [{ text: 'TUNDE BARBING SALOON', sub: 'Unisex • Low cut • Shaving', colors: ['#f8f9fa', '#c1121f'] }],
  photo: [{ text: 'UNITY PHOTO STUDIO', sub: 'Passport Photos in 10 Minutes', colors: ['#003049', '#fcbf49'] }],
  canteen: [{ text: 'MAMA PUT CANTEEN', sub: 'Jollof • Moi-moi • Chilled Drinks', colors: ['#f77f00', '#ffffff'] }],
  books: [{ text: 'YABA BOOKS & STATIONERY', sub: 'JAMB • WAEC • Textbooks', colors: ['#fefae0', '#283618'] }],
  general: [{ text: 'GOD’S GRACE VENTURES', sub: 'General Merchandise', colors: ['#ffffff', '#3a0ca3'] }],
};
const FAMILY_NAMES = ['Adeyemi', 'Okafor', 'Bello', 'Eze', 'Lawal', 'Ogun', 'Adebayo', 'Nwosu', 'Bakare', 'Ibe', 'Danjuma', 'Afolabi', 'Okonkwo', 'Salami', 'Uche', 'Balogun'];

export const YABA_PARAMS: DistrictParams = {
  place: 'Yaba, Lagos', era: '2003', text: 'Rue commerçante de Yaba (Lagos) vers 2003, avec un cybercafé accessible.', seed: 'yaba',
  street: { length: 76, carriageway: 7, sidewalk: 3.2 },
  storeys: [2, 3],
  cafe: { side: 'south', position: 0.42, width: 12, depth: 11, workstations: 6, layout: 'sides' },
  trades: ['provisions', 'phones', 'chemist', 'business', 'electricals', 'fashion', 'barber', 'photo', 'canteen', 'books', 'general'],
};

/** Bounds the generator accepts (the panel uses the same ones). */
export const PARAM_LIMITS = {
  length: [40, 120], carriageway: [5, 10], sidewalk: [1.8, 4.5], cafeWidth: [8, 16], cafeDepth: [8, 16], workstations: [2, 12], storeys: [1, 4],
} as const;

const clamp = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));

/** The cybercafé building: a door near one end, barred display windows, rooms sized from the parameters. */
function cafeBuilding(x: number, side: 1 | -1, frontZ: number, w: number, d: number): BuildingSpec {
  const doorOffset = -w / 2 + 2.1;
  const openings: Opening[] = [op('door', 'front', doorOffset, 1.25, 2.25, 0)];
  const span0 = doorOffset + 1.4, span1 = w / 2 - 0.6, nWin = Math.max(1, Math.floor((span1 - span0) / 3.4));
  for (let i = 0; i < nWin; i++) openings.push(op('window', 'front', span0 + (i + 0.5) * ((span1 - span0) / nWin), Math.min(2.4, (span1 - span0) / nWin - 0.8), 1.45, 0, 0.95));
  const up = Math.max(1, Math.floor(w / 3.4));
  for (let i = 0; i < up; i++) openings.push(op('window', 'front', -w / 2 + (i + 0.5) * (w / up), 1.5, 1.35, 1, 0.95));
  openings.push(op('window', 'left', -d / 2 - 1, 1.4, 1.2, 1, 1.0), op('window', 'back', 0, 1.4, 1.2, 1, 1.0));
  return {
    id: CAFE.building, name: 'Immeuble du cybercafé', front: [x, 0.15, side * frontZ], yaw: side === 1 ? 180 : 0, width: w, depth: d, floors: 2, floorHeight: 3.4,
    style: { wall: 'plaster', trim: 'concrete', paint: PAINT.cream, base: [0.33, 0.36, 0.42], roof: 'parapet', balcony: true, louvres: true, bars: true },
    openings,
    rooms: [{ id: CAFE.room, name: 'Cybercafé', kind: 'cybercafe', level: 0, rect: [-w / 2 + 0.25, -d + 0.25, w / 2 - 0.25, -0.25] }],
    signs: [
      { text: 'NETLINK CYBER CAFÉ', sub: 'Browsing ₦150/hr • Printing • Scanning • E-mail', colors: ['#0d3b66', '#f4f1de'], level: 0, kind: 'board' },
      { text: 'CYBER', sub: 'OPEN 24HRS', colors: ['#e63946', '#ffffff'], level: 0, kind: 'blade' },
    ],
  };
}

/**
 * Generate a street from parameters: same building kit and construction as the authored Yaba block, but the
 * street length and width, the café's side, position, size and workstation count, the storeys and the shop
 * trades all change the geometry and organisation. Deterministic for a given seed.
 */
export function districtPlan(input: DistrictParams): DistrictPlan {
  n = 0;
  const p = structuredClone(input);
  p.street.length = clamp(p.street.length, PARAM_LIMITS.length);
  p.street.carriageway = clamp(p.street.carriageway, PARAM_LIMITS.carriageway);
  p.street.sidewalk = clamp(p.street.sidewalk, PARAM_LIMITS.sidewalk);
  p.cafe.width = clamp(p.cafe.width, PARAM_LIMITS.cafeWidth);
  p.cafe.depth = clamp(p.cafe.depth, PARAM_LIMITS.cafeDepth);
  p.cafe.workstations = Math.round(clamp(p.cafe.workstations, PARAM_LIMITS.workstations));
  p.cafe.position = Math.min(1, Math.max(0, p.cafe.position));
  p.storeys = [Math.round(clamp(p.storeys[0], PARAM_LIMITS.storeys)), Math.round(clamp(Math.max(p.storeys[0], p.storeys[1]), PARAM_LIMITS.storeys))];
  const rnd = seeded(p.seed);
  const L = p.street.length, frontZ = p.street.carriageway / 2 + 0.7 + p.street.sidewalk;
  const x0 = -L / 2 + 1.5, x1 = L / 2 - 1.5;
  const cafeSide: 1 | -1 = p.cafe.side === 'north' ? 1 : -1;
  const cw = p.cafe.width;
  const cafeX = Math.min(x1 - cw / 2, Math.max(x0 + cw / 2, x0 + p.cafe.position * (x1 - x0)));
  const paints = Object.keys(PAINT) as (keyof typeof PAINT)[];
  let tradeIdx = 0, familyIdx = Math.floor(rnd() * FAMILY_NAMES.length);
  const buildings: BuildingSpec[] = [];
  for (const side of [-1, 1] as const) {
    // free frontage segments on this side (the café reserves its own)
    const segs: [number, number][] = side === cafeSide ? [[x0, cafeX - cw / 2 - 0.6], [cafeX + cw / 2 + 0.6, x1]] : [[x0, x1]];
    for (const [a, b] of segs) {
      let x = a;
      while (b - x >= 6.5) {
        let w = 8 + rnd() * 4;
        if (b - x - w < 6.5) w = Math.min(13, b - x); // absorb a too-short remainder
        const depth = 9 + Math.round(rnd() * 2);
        const floors = p.storeys[0] + Math.floor(rnd() * (p.storeys[1] - p.storeys[0] + 1));
        const trade = p.trades.length ? p.trades[tradeIdx++ % p.trades.length] : 'general';
        const names = SHOP_NAMES[trade];
        const ident = names[Math.floor(rnd() * names.length)];
        const shops = w >= 9.4 ? [{ offset: -w / 4 - 0.1, width: Math.min(3.4, w / 2 - 1.4) }, { offset: w / 4, width: Math.min(3.2, w / 2 - 1.6) }] : [{ offset: 0, width: Math.min(3.8, w - 2.6) }];
        const id = `b.${side === 1 ? 'n' : 's'}${buildings.length + 1}`;
        buildings.push(shopHouse(id, `Immeuble ${FAMILY_NAMES[familyIdx++ % FAMILY_NAMES.length]}`, x + w / 2, side === 1 ? 1 : -1, w, depth, floors, paints[Math.floor(rnd() * paints.length)], shops,
          { ...ident, level: 0, kind: 'board' }, {}, trade, frontZ));
        x += w + 0.4 + rnd() * 0.9; // narrow alleys between plots
      }
    }
  }
  buildings.push(cafeBuilding(cafeX, cafeSide, frontZ, cw, p.cafe.depth));
  // street ends: buildings across the junctions close the vista
  const endW = 2 * frontZ + 11;
  buildings.push({ ...shopHouse('b.e', 'Immeuble du carrefour', 0, -1, endW, 9, Math.max(2, p.storeys[1]), 'mint', [{ offset: -endW / 3, width: 3.4 }, { offset: 0, width: 3.4 }, { offset: endW / 3, width: 3.4 }],
    { text: 'ADUNNI PLAZA', sub: 'Shops • Offices to Let', colors: ['#264653', '#e9c46a'], level: 1, kind: 'painted' }, {}, 'general', frontZ), front: [L / 2 + 4, 0.15, 0], yaw: -90 });
  buildings.push({ ...shopHouse('b.w', 'Immeuble ouest', 0, -1, endW, 9, Math.max(2, p.storeys[0]), 'rose', [{ offset: -endW / 4, width: 3.4 }, { offset: endW / 4, width: 3.4 }],
    { text: 'GOD’S TIME IS THE BEST VENTURES', colors: ['#fff', '#7b2cbf'], level: 1, kind: 'painted' }, {}, 'general', frontZ), front: [-L / 2 - 4, 0.15, 0], yaw: 90 });
  return {
    brief: { place: p.place, era: p.era, mood: '', text: p.text },
    params: p,
    street: { ...p.street, drain: true },
    buildings,
    requires: [],
    missing: [],
  };
}
