// Minimal stroke icon set (inline SVG, 1.6px strokes on a 20px grid).
const P = {
  undo: 'M7 6 3.5 9.5 7 13M4 9.5h7.5a4.5 4.5 0 0 1 0 9H9',
  redo: 'm13 6 3.5 3.5L13 13m3-3.5H8.5a4.5 4.5 0 0 0 0 9H11',
  gear: 'M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2Zm6.3-1.4.1-1.2-.1-1.2 1.6-1.3-1.6-2.8-2 .7a6 6 0 0 0-2-1.2L12 2H8.6l-.4 2.2a6 6 0 0 0-2 1.2l-2-.7-1.6 2.8L4.2 8.8 4 10l.1 1.2-1.6 1.3 1.6 2.8 2-.7c.6.5 1.3.9 2 1.2l.4 2.2H12l.4-2.2c.7-.3 1.4-.7 2-1.2l2 .7 1.6-2.8-1.7-1.3Z',
  grid: 'M3.5 3.5h5v5h-5zM11.5 3.5h5v5h-5zM3.5 11.5h5v5h-5zM11.5 11.5h5v5h-5z',
  move: 'M10 2.5v15M2.5 10h15M10 2.5 7.8 4.7M10 2.5l2.2 2.2M10 17.5l-2.2-2.2M10 17.5l2.2-2.2M2.5 10l2.2-2.2M2.5 10l2.2 2.2M17.5 10l-2.2-2.2M17.5 10l-2.2 2.2',
  rotate: 'M16 10a6 6 0 1 1-1.8-4.3M16 3v3.5h-3.5',
  scale: 'M3.5 16.5 16.5 3.5M11 3.5h5.5V9M9 16.5H3.5V11',
  copy: 'M7 7h9.5v9.5H7zM13 7V3.5H3.5V13H7',
  trash: 'M4 5.5h12M8 5.5V3.5h4v2M5.5 5.5l.8 11h7.4l.8-11',
  lock: 'M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 5 0V9',
  unlock: 'M5.5 9h9v7.5h-9zM7.5 9V6.5a2.5 2.5 0 0 1 4.9-.7',
  camera: 'M3 6.5h3l1.5-2h5l1.5 2h3v9.5H3zM10 13.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
  plus: 'M10 4v12M4 10h12',
  walk: 'M11 4.2a1.2 1.2 0 1 0 0-.1M9.5 7.5l-2 3.5 2.5 1.5-1 4.5M9.5 7.5l3 2 2.5.5M10 12.5l3 1 .5 3',
  target: 'M10 16.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM10 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  close: 'M5 5l10 10M15 5 5 15',
  check: 'm4.5 10.5 3.5 3.5 7.5-8',
  chevron: 'm7.5 4.5 5.5 5.5-5.5 5.5',
  search: 'M8.8 14.6a5.8 5.8 0 1 0 0-11.6 5.8 5.8 0 0 0 0 11.6ZM13 13l4 4',
  turn: 'M5 15V9a4 4 0 0 1 4-4h6M12.5 2.5 15 5l-2.5 2.5',
  pulse: 'M2.5 10h3.5l2-5 4 10 2-5h3.5',
  cloud: 'M6 15.5h8.5a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 6 15.5Z',
  down: 'M10 3.5v10m0 0-3.5-3.5M10 13.5l3.5-3.5M4 16.5h12',
} as const;

export type IconName = keyof typeof P;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}
