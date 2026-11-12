/**
 * Page titles and favicons for saved web links, fetched from this machine. Every fetch is time- and
 * size-limited, and failures just mean no title or no icon.
 */

const TIMEOUT_MS = 5000;
/** A <title> is near the top; reading more of a big page is wasted. */
const MAX_PAGE_BYTES = 512 * 1024;
const MAX_ICON_BYTES = 100 * 1024;
// A generic client name: some sites refuse requests without a browser-like user agent
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; Dashboard link preview)' };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
  });
}

/** The page's <title>, tidied; empty when it has none. */
export function parseTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1]).replace(/\s+/g, ' ').trim().slice(0, 200) : '';
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find((v) => v !== undefined);

/** The icon a page declares with <link rel="icon">, else the site's /favicon.ico. */
export function parseIconUrl(html: string, pageUrl: string): string {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = attr(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    const href = attr(tag, 'href');
    if (href && (rel.includes('icon') || rel.includes('apple-touch-icon'))) {
      try {
        const url = new URL(decodeEntities(href), pageUrl);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
      } catch {
        // an unusable href: try the next one
      }
    }
  }
  return new URL('/favicon.ico', pageUrl).href;
}

/** Up to `max` bytes of the body; null when a declared length is over `max` and `truncate` is off. */
async function readBody(res: Response, max: number, truncate: boolean): Promise<Uint8Array | null> {
  if (!truncate && Number(res.headers.get('content-length')) > max) return null;
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size <= max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  if (size > max && !truncate) return null;
  const body = new Uint8Array(Math.min(size, max));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, body.length - offset);
    body.set(part, offset);
    offset += part.length;
  }
  return body;
}

export interface PageInfo {
  title: string;
  iconUrl: string;
}

/** The page's title and icon address, or null when it can't be fetched as HTML. */
export async function fetchPageInfo(url: string): Promise<PageInfo | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok || !/html/i.test(res.headers.get('content-type') ?? '')) return null;
    const html = new TextDecoder().decode((await readBody(res, MAX_PAGE_BYTES, true)) ?? undefined);
    // Relative icon links resolve against the page we ended up on, after redirects
    return { title: parseTitle(html), iconUrl: parseIconUrl(html, res.url || url) };
  } catch {
    return null;
  }
}

export interface Icon {
  contentType: string;
  data: Buffer;
}

/** An image of at most 100 KB, or null. */
export async function fetchIcon(url: string): Promise<Icon | null> {
  try {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const contentType = res.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!res.ok || !contentType.startsWith('image/')) return null;
    const body = await readBody(res, MAX_ICON_BYTES, false);
    return body && body.length ? { contentType, data: Buffer.from(body) } : null;
  } catch {
    return null;
  }
}

/** Runs `fn` over `items`, at most `limit` at a time, keeping their order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
