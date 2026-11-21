/**
 * Google Books API（volumes.list）の呼び出しと書誌情報の整形。
 * 自動再試行はしない。
 */

export interface NormalizedBook {
  id: string;
  title: string;
  authors: string[];
  coverUrl: string | null;
  description: string | null;
  infoUrl: string | null;
}

export type GoogleBooksFailureKind = 'http' | 'shape' | 'timeout' | 'network';

export class GoogleBooksError extends Error {
  readonly kind: GoogleBooksFailureKind;
  /** `kind === 'http'` のときの HTTP ステータス。取得できなければ undefined。 */
  readonly statusCode: number | undefined;

  constructor(
    kind: GoogleBooksFailureKind,
    message = 'google books request failed',
    statusCode?: number,
  ) {
    super(message);
    this.name = 'GoogleBooksError';
    this.kind = kind;
    this.statusCode = statusCode;
  }
}

export interface GoogleBooksGateway {
  /** 検索結果の items（未整形）を返す。0件は空配列。API キーは呼び出し側で解決する。 */
  search(query: string, apiKey: string | undefined, abortSignal: AbortSignal): Promise<unknown[]>;
}

export interface GoogleBooksGatewayOptions {
  fetchImpl?: typeof fetch;
}

const GOOGLE_BOOKS_ENDPOINT = 'https://www.googleapis.com/books/v1/volumes';
const COVER_HTTPS_UPGRADE_HOSTS = new Set(['books.google.com', 'books.googleusercontent.com']);
const INFO_HOSTS = new Set(['books.google.com', 'books.google.co.jp']);
const MAX_DESCRIPTION_CODE_POINTS = 1000;
/** ひらがな・カタカナ（U+3040–U+30FF）。 */
const KANA_PATTERN = /[\u3040-\u30FF]/;

/**
 * 雑誌・旅行ガイドを除外するための書名キーワード（小文字比較）。
 * 書名にこれらを含む候補は、主題が近くてもおすすめの本として扱わない。
 * 例: 「るるぶ京都」「まっぷる東京」「地球の歩き方 九州」「MOOK 暮らし」。
 */
const EXCLUDED_TITLE_KEYWORDS: readonly string[] = [
  'るるぶ',
  'まっぷる',
  'ことりっぷ',
  '地球の歩き方',
  'ムック',
  'mook',
  '月号',
  '増刊',
];

/** Google Books の categories で旅行ガイドと分かる値（trim・小文字化して比較）。 */
const TRAVEL_CATEGORY = 'travel';
/**
 * 旅行ガイドとして除外しない紀行文学・評論・研究の手がかり。
 * `Travel Writing` のような紀行文学のカテゴリを巻き込まないために使う。
 */
const TRAVEL_LITERATURE_TERMS: readonly string[] = [
  'essays',
  'travelogue',
  'writing',
  'literary',
];

export function createGoogleBooksGateway(
  options: GoogleBooksGatewayOptions = {},
): GoogleBooksGateway {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async search(
      query: string,
      apiKey: string | undefined,
      abortSignal: AbortSignal,
    ): Promise<unknown[]> {
      const url = buildSearchUrl(query, apiKey);

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: abortSignal,
        });
      } catch (error) {
        throw classifyFetchError(error, abortSignal);
      }

      if (!response.ok) {
        throw new GoogleBooksError('http', 'google books request failed', response.status);
      }

      let payload: unknown;
      try {
        payload = (await response.json()) as unknown;
      } catch (error) {
        // ヘッダー受信後の本文読み取り中に打ち切られた場合も timeout として扱う
        // （fetch 自体の catch と同じ判定を共有する）。
        throw classifyReadError(error, abortSignal);
      }

      // トップレベルが配列・非オブジェクトは上流の異常応答として 0 件にしない。
      if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        throw new GoogleBooksError('shape');
      }
      const record = payload as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(record, 'items')) {
        // items の欠落を 0 件として認めるのは、実測済みの空結果（totalItems が数値 0）だけ。
        // 空オブジェクト・正の件数・totalItems なしは形状不正として 502 にする。
        if (record.totalItems === 0) return [];
        throw new GoogleBooksError('shape');
      }
      const items = record.items;
      // items が存在して配列でない（null を含む）場合も異常応答。
      if (!Array.isArray(items)) throw new GoogleBooksError('shape');
      return items;
    },
  };
}

function buildSearchUrl(query: string, apiKey: string | undefined): string {
  const url = new URL(GOOGLE_BOOKS_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('langRestrict', 'ja');
  url.searchParams.set('printType', 'books');
  url.searchParams.set('orderBy', 'relevance');
  url.searchParams.set('maxResults', '20');
  if (apiKey) url.searchParams.set('key', apiKey);
  return url.toString();
}

function classifyFetchError(error: unknown, abortSignal: AbortSignal): GoogleBooksError {
  if (isAbortLikeError(error, abortSignal)) return new GoogleBooksError('timeout');
  return new GoogleBooksError('network');
}

/** 本文読み取りの失敗は、打ち切りなら timeout、それ以外（不正 JSON など）は shape。 */
function classifyReadError(error: unknown, abortSignal: AbortSignal): GoogleBooksError {
  if (isAbortLikeError(error, abortSignal)) return new GoogleBooksError('timeout');
  return new GoogleBooksError('shape');
}

function isAbortLikeError(error: unknown, abortSignal: AbortSignal): boolean {
  if (abortSignal.aborted) return true;
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    return true;
  }
  return (error as { code?: unknown } | null)?.code === 'ABORT_ERR';
}

/**
 * Google Books の items を API 契約の書誌情報へ整形する。
 * ID・書名がない候補に加え、雑誌・旅行ガイド、日本語以外の言語の候補、内容紹介が
 * ありながらかな（ひらがな・カタカナ）を1文字も含まない候補（中国語・英語の紹介文など）
 * も除外する。内容紹介がない候補は書名だけでは除外しない。重複除去と最大5件は呼び出し側。
 */
export function normalizeVolumes(items: readonly unknown[]): NormalizedBook[] {
  const books: NormalizedBook[] = [];
  for (const item of items) {
    const book = normalizeVolume(item);
    if (book) books.push(book);
  }
  return books;
}

function normalizeVolume(item: unknown): NormalizedBook | null {
  if (typeof item !== 'object' || item === null) return null;
  const record = item as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (id === '') return null;

  const volumeInfo = asRecord(record.volumeInfo);
  if (!volumeInfo) return null;
  const title = typeof volumeInfo.title === 'string' ? volumeInfo.title.trim() : '';
  if (title === '') return null;
  if (isMagazineOrTravelGuide(title, volumeInfo.categories)) return null;

  const imageLinks = asRecord(volumeInfo.imageLinks);

  // 日本語以外の候補は返さない（langRestrict=ja でも繁体字中国語などが混ざるため）。
  const language =
    typeof volumeInfo.language === 'string' ? volumeInfo.language.trim().toLowerCase() : null;
  if (language !== null && language !== 'ja' && !language.startsWith('ja-')) return null;

  const description = formatDescription(volumeInfo.description);
  // 内容紹介があるのにかなを含まない本（中国語・英語の紹介文）も除く。
  // 内容紹介がない場合は書名だけでは除外しない。
  if (description !== null && !KANA_PATTERN.test(description)) return null;

  return {
    id,
    title,
    authors: normalizeAuthors(volumeInfo.authors),
    coverUrl: pickHttpsUrl(imageLinks, ['thumbnail', 'smallThumbnail'], COVER_HTTPS_UPGRADE_HOSTS),
    description,
    infoUrl: pickInfoUrl(volumeInfo),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * 雑誌・旅行ガイドを除外する。
 * 書名のキーワード（大文字小文字を無視）と `volumeInfo.categories` の Travel で判定する。
 * 書名だけでは主題を表す語（例「旅の哲学」）を巻き込まないよう、キーワードは
 * 実測した定期刊行物・旅行ガイドの名前に限定する。
 */
function isMagazineOrTravelGuide(title: string, categories: unknown): boolean {
  const lowerTitle = title.toLowerCase();
  if (EXCLUDED_TITLE_KEYWORDS.some((keyword) => lowerTitle.includes(keyword))) return true;
  if (!Array.isArray(categories)) return false;
  return categories.some(isTravelGuideCategory);
}

/**
 * 旅行ガイドのカテゴリだけを除外する。
 * `Travel` 一致または `Travel / ...` 始まりを対象にし、紀行文学・評論・研究を示す
 * `Essays`・`Travelogue`・`Writing`・`Literary` を含むものは除外しない。
 */
function isTravelGuideCategory(category: unknown): boolean {
  if (typeof category !== 'string') return false;
  const normalized = category.trim().toLowerCase();
  const isTravel =
    normalized === TRAVEL_CATEGORY || normalized.startsWith(`${TRAVEL_CATEGORY} /`);
  if (!isTravel) return false;
  return !TRAVEL_LITERATURE_TERMS.some((term) => normalized.includes(term));
}

function normalizeAuthors(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const authors: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const author = item.trim();
    if (author !== '') authors.push(author);
  }
  return authors;
}

function pickInfoUrl(volumeInfo: Record<string, unknown>): string | null {
  for (const key of ['infoLink', 'canonicalVolumeLink']) {
    const candidate = toHttpsUrl(volumeInfo[key], INFO_HOSTS);
    if (!candidate) continue;
    const host = new URL(candidate).hostname.toLowerCase();
    if (INFO_HOSTS.has(host)) return candidate;
  }
  return null;
}

function pickHttpsUrl(
  source: Record<string, unknown> | null,
  keys: readonly string[],
  upgradeHosts: ReadonlySet<string>,
): string | null {
  if (!source) return null;
  for (const key of keys) {
    const candidate = toHttpsUrl(source[key], upgradeHosts);
    if (candidate) return candidate;
  }
  return null;
}

function toHttpsUrl(value: unknown, upgradeHosts: ReadonlySet<string>): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:' && upgradeHosts.has(url.hostname.toLowerCase())) {
    url.protocol = 'https:';
    return url.toString();
  }
  return null;
}

/** `<` の直後が英字・`/英字`・`!` の「本物のタグ」だけを除去する。`a < b > c` は保持する。 */
const HTML_TAG_PATTERN = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|<![^>]*>/g;

/** タブ・改行以外の C0 制御文字と DEL。 */
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** 対になっていないサロゲート。 */
const LONE_SURROGATE_PATTERN =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * 内容紹介の整形。
 * タグ除去 → エンティティデコード → 再度タグ除去（`&lt;b&gt;` 由来のタグを消す）
 * → 制御文字除去 → 空白正規化 → 最大 1,000 コードポイント。空になったら null。
 */
export function formatDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutTags = removeHtmlTags(value);
  const decoded = decodeEntities(withoutTags);
  const withoutDecodedTags = removeHtmlTags(decoded);
  const withoutControlChars = withoutDecodedTags
    .replace(CONTROL_CHAR_PATTERN, '')
    .replace(LONE_SURROGATE_PATTERN, '');
  const normalized = withoutControlChars.replace(/[\s\u3000]+/g, ' ').trim();
  if (normalized === '') return null;
  const codePoints = [...normalized];
  const truncated =
    codePoints.length > MAX_DESCRIPTION_CODE_POINTS
      ? codePoints.slice(0, MAX_DESCRIPTION_CODE_POINTS).join('').trimEnd()
      : normalized;
  return truncated === '' ? null : truncated;
}

function removeHtmlTags(value: string): string {
  return value.replace(HTML_TAG_PATTERN, ' ');
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** 1 回の置換でデコードする（二重デコードを避ける）。 */
function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return codePointToString(Number.parseInt(body.slice(2), 16)) ?? match;
    }
    if (body.startsWith('#')) {
      return codePointToString(Number.parseInt(body.slice(1), 10)) ?? match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function codePointToString(codePoint: number): string | null {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return null;
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return null;
  }
}
