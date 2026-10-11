export interface WorldIntent {
  brief: string;
  title: string;
  queries: string[];
  signals: {
    place?: string;
    year?: number;
    urbanity: 'urban' | 'semi-urban' | 'rural' | 'unspecified';
  };
}

/**
 * Deterministic first pass before an LLM planner is connected.
 * It preserves the user's brief and turns it into concrete asset-discovery queries instead of
 * generating placeholder geometry.
 */
export function compileWorldIntent(raw: string): WorldIntent {
  const brief = raw.trim().replace(/\s+/g, ' ');
  if (!brief) throw new Error('World brief is empty');
  const yearMatch = brief.match(/\b(18|19|20)\d{2}\b/);
  const placeMatch = brief.match(/\b(?:in|à|au|aux|dans|near|près de)\s+([A-ZÀ-Ý][\p{L}'’-]+(?:\s+[A-ZÀ-Ý][\p{L}'’-]+){0,2})/u);
  const lower = brief.toLowerCase();
  const urbanity = /rural|village|campagne/.test(lower) ? 'rural'
    : /semi[- ]?urban|périurb|suburb/.test(lower) ? 'semi-urban'
    : /city|urban|ville|street|rue|quartier|downtown/.test(lower) ? 'urban' : 'unspecified';
  const place = placeMatch?.[1];
  const context = [place, yearMatch?.[0]].filter(Boolean).join(' ');
  const queries = [
    brief,
    [context, 'building architecture'].filter(Boolean).join(' '),
    [context, 'street shop storefront'].filter(Boolean).join(' '),
    [context, 'street furniture'].filter(Boolean).join(' '),
    [context, 'tree vegetation'].filter(Boolean).join(' '),
  ].filter((q, i, arr) => q && arr.indexOf(q) === i);
  return {
    brief,
    title: brief.length <= 54 ? brief : brief.slice(0, 51) + '…',
    queries,
    signals: { place, year: yearMatch ? Number(yearMatch[0]) : undefined, urbanity },
  };
}
