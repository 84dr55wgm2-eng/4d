import type { BuildingSpec, DistrictPlan, Opening } from '../../core/types';

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
  shops: { offset: number; width: number }[], sign?: BuildingSpec['signs'][number], extra: Partial<BuildingSpec['style']> = {}): BuildingSpec {
  const openings: Opening[] = shops.map((s) => op('shopfront', 'front', s.offset, s.width, 2.6, 0));
  for (let f = 1; f < floors; f++) {
    const count = Math.max(1, Math.floor(width / 3.2));
    for (let i = 0; i < count; i++) openings.push(op('window', 'front', -width / 2 + (i + 0.5) * (width / count), 1.5, 1.35, f, 0.95));
    openings.push(op('window', 'left', -depth / 2 + 2.5, 1.2, 1.2, f, 1.0));
    openings.push(op('window', 'back', 0, 1.4, 1.2, f, 1.0));
  }
  return {
    id, name, front: [x, 0.15, side * FRONT_Z], yaw: side === 1 ? 180 : 0, width, depth, floors, floorHeight: 3.2,
    style: { wall: 'plaster', trim: 'concrete', paint: PAINT[paint], roof: 'parapet', balcony: floors > 1 && width > 7, louvres: true, bars: true, ...extra },
    openings, rooms: [], signs: sign ? [sign] : [],
  };
}

export function yabaPlan(): DistrictPlan {
  n = 0;
  const south: BuildingSpec[] = [
    shopHouse('b.s1', 'Immeuble Adeyemi', -30, -1, 9, 10, 2, 'ochre', [{ offset: -2, width: 3 }, { offset: 2.2, width: 2.6 }],
      { text: 'MAMA BISI PROVISIONS', sub: 'Beverages • Provisions • Toiletries', colors: ['#f3e2a6', '#8b1a12'], level: 0, kind: 'board' }),
    shopHouse('b.s2', 'Immeuble Okafor', -19.6, -1, 10.5, 11, 3, 'sky', [{ offset: -2.6, width: 3.2 }, { offset: 2.4, width: 3 }],
      { text: 'GLORY GSM CENTRE', sub: 'Phones • Recharge Cards • Accessories', colors: ['#14427a', '#ffd23f'], level: 0, kind: 'board' }),
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
      { text: 'DIVINE FAVOUR CHEMIST', sub: 'Patent Medicine Store', colors: ['#ffffff', '#1b7a3a'], level: 0, kind: 'board' }),
    shopHouse('b.s5', 'Immeuble Eze', 15.6, -1, 10, 10, 3, 'rose', [{ offset: -2.5, width: 3 }, { offset: 2.4, width: 3 }],
      { text: 'BLESSED HANDS BUSINESS CENTRE', sub: 'Typing • Photocopy • Lamination • Binding', colors: ['#fff4d6', '#202060'], level: 0, kind: 'board' }),
    shopHouse('b.s6', 'Immeuble Lawal', 26, -1, 9.4, 9, 2, 'lemon', [{ offset: -1.8, width: 2.8 }, { offset: 2.3, width: 2.4 }],
      { text: 'ADE & SONS ELECTRICALS', sub: 'Wiring • Bulbs • Stabilizers', colors: ['#1d1d1d', '#ffcc00'], level: 0, kind: 'board' }),
  );
  const north: BuildingSpec[] = [
    shopHouse('b.n1', 'Immeuble Ogun', -28.5, 1, 12, 10, 3, 'white', [{ offset: -3, width: 3.4 }, { offset: 2.6, width: 3.4 }],
      { text: 'KINGSWAY FASHION HOUSE', sub: 'Tailoring • Aso-Ebi • Alterations', colors: ['#5a189a', '#fde68a'], level: 0, kind: 'board' }),
    shopHouse('b.n2', 'Immeuble Adebayo', -16.4, 1, 10, 10, 2, 'green', [{ offset: 0, width: 3.8 }],
      { text: 'TUNDE BARBING SALOON', sub: 'Unisex • Low cut • Shaving', colors: ['#f8f9fa', '#c1121f'], level: 0, kind: 'board' }),
    shopHouse('b.n3', 'Immeuble Nwosu', -5.2, 1, 10.5, 11, 3, 'sand', [{ offset: -2.6, width: 3 }, { offset: 2.5, width: 3 }],
      { text: 'UNITY PHOTO STUDIO', sub: 'Passport Photos in 10 Minutes', colors: ['#003049', '#fcbf49'], level: 0, kind: 'board' }),
    shopHouse('b.n4', 'Immeuble Bakare', 6.4, 1, 10, 10, 2, 'ochre', [{ offset: -2.4, width: 3 }, { offset: 2.4, width: 2.8 }],
      { text: 'MAMA PUT CANTEEN', sub: 'Jollof • Moi-moi • Chilled Drinks', colors: ['#f77f00', '#ffffff'], level: 0, kind: 'board' }),
    shopHouse('b.n5', 'Immeuble Ibe', 17.6, 1, 10.5, 10, 3, 'sky', [{ offset: 0, width: 4 }],
      { text: 'YABA BOOKS & STATIONERY', sub: 'JAMB • WAEC • Textbooks', colors: ['#fefae0', '#283618'], level: 0, kind: 'board' }),
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
