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

/** 空白・全角空白の連続。 */
const WHITESPACE_PATTERN = /[\s\u3000]+/g;

/**
 * 定型注意書きの目印。テンプレートと一緒に現れたときだけ、そのテンプレートごと除去する。
 * 注意ラベルは中に `【`・`】` を含めない（外側の `【` を飲み込まない）。
 */
const NOTICE_MARKER_SOURCE = '※|＊|\\*|【[^【】]{0,20}注意[^【】]{0,20}】';

/**
 * 目印の連なり（目印の間の空白を含む）。テンプレートの直前だけを対象にする。
 * 走査量を抑えるため、先頭の1個に続く目印は上限付きにする。
 */
const MAX_NOTICE_MARKER_RUN = 4;
const NOTICE_MARKER_PREFIX_SOURCE =
  `(?:${NOTICE_MARKER_SOURCE})(?:\\s*(?:${NOTICE_MARKER_SOURCE})){0,${MAX_NOTICE_MARKER_RUN}}`;

/**
 * 定型注意書きの終わり。直後が「空白1つ＋句点」「文末」「閉じ括弧」の場合だけ一致する。
 * 空白の後に普通の文字が続く場合（タグ由来の空白など）は一致させない。
 * 句点は任意で一緒に消し、閉じ括弧は消費しない。
 */
const BOILERPLATE_END_SOURCE = '(?:\\s?。|(?=\\s?(?:[）)］】]|$)))';

/**
 * 目印の付かない定型注意書きの始まり。文頭・句読点・開き括弧の直後だけを許し、
 * その間の空白は最大1つとする。文の途中からの一致を防ぐ。
 * 文頭は `^` で、句読点・開き括弧は直後の空白だけを消費する後読みで表す。
 */
const BOILERPLATE_START_SOURCE = '(?:^|(?<=[。！？!?（(［【]))\\s?';

/** 掲載物。T5 の続きと T6 で共通に使う。 */
const MISSING_CONTENT_SOURCE = '(?:ページ|記事|写真|画像|付録)';

/** T1 端末の注意。固定レイアウトの前置きは任意。 */
const DEVICE_NOTICE_TEMPLATE_SOURCE =
  'この(?:商品|電子書籍)は' +
  '(?:固定レイアウト(?:型)?で(?:作成|配信)されており、)?' +
  'タブレットなど大きい?ディスプレイを備えた端末で読むことに適しています' +
  BOILERPLATE_END_SOURCE;

/** T2 閲覧の推奨。「など(の大きな)端末」「端末」の言い回しだけを列挙する。 */
const VIEWING_RECOMMENDATION_TEMPLATE_SOURCE =
  'この(?:商品|電子書籍|書籍)は' +
  '(?:タブレット|スマートフォン|大きい?ディスプレイ)' +
  '(?:など(?:の(?:大きな)?端末)?|端末)?' +
  'での閲覧を(?:推奨|おすすめ|お勧め)しています' +
  BOILERPLATE_END_SOURCE;

/** T3 固定レイアウトの配信。 */
const FIXED_LAYOUT_TEMPLATE_SOURCE =
  'この(?:商品|電子書籍)は固定レイアウト(?:型)?で(?:配信|作成)されて(?:おります|います)' +
  BOILERPLATE_END_SOURCE;

/** T4 機能制限で列挙する機能名。 */
const FUNCTION_LIMIT_NAME_SOURCE = '(?:文字列のハイライト|検索|辞書の参照|引用)';

/** T4 機能制限。「また、」「固定レイアウト型は」の前置きは任意。 */
const FUNCTION_LIMIT_TEMPLATE_SOURCE =
  '(?:また、|固定レイアウト型は)?' +
  '文字だけを拡大すること(?:や、?|、)' +
  FUNCTION_LIMIT_NAME_SOURCE +
  `(?:(?:、|や)${FUNCTION_LIMIT_NAME_SOURCE}){0,3}` +
  'など(?:の機能)?が(?:使用|利用)できません' +
  BOILERPLATE_END_SOURCE;

/** T5 電子版と紙版の差。終わり方を列挙し、任意文字の幅を持たせない。 */
const DIGITAL_PRINT_DIFFERENCE_BODY_SOURCE =
  '電子版(?:は|では)、?紙(?:版|の書籍|の本)(?:とは|と)、?' +
  '(?:コンテンツ|内容)が一部' +
  '(?:異なります' +
  '|異なる場合があります' +
  `|異なる場合や、掲載されない${MISSING_CONTENT_SOURCE}` +
  `(?:(?:、|や)${MISSING_CONTENT_SOURCE}){0,2}がある場合があります)`;

/** T6 の本文。T5 の直後にだけ続く「掲載されていない…」の文。 */
const MISSING_PAGES_BODY_SOURCE =
  `掲載されていない${MISSING_CONTENT_SOURCE}` +
  `(?:(?:、|や)${MISSING_CONTENT_SOURCE}){0,2}があります`;

/**
 * T5 と、その直後（句点または空白、目印だけを挟む）に続く T6 をまとめて一致させる。
 * T6 が続かない場合は T5 単独の終わりとして判定する。
 */
const DIGITAL_PRINT_DIFFERENCE_ITEM_SOURCE =
  `${DIGITAL_PRINT_DIFFERENCE_BODY_SOURCE}` +
  `(?:\\s?(?:。\\s*|\\s+)(?:${NOTICE_MARKER_PREFIX_SOURCE}\\s*)?` +
  `${MISSING_PAGES_BODY_SOURCE}${BOILERPLATE_END_SOURCE}` +
  `|${BOILERPLATE_END_SOURCE})`;

/** 定型文1件の本体（始まりと終わりの境界は外側で付ける）。 */
const BOILERPLATE_ITEM_SOURCE =
  `(?:${DEVICE_NOTICE_TEMPLATE_SOURCE}` +
  `|${VIEWING_RECOMMENDATION_TEMPLATE_SOURCE}` +
  `|${FIXED_LAYOUT_TEMPLATE_SOURCE}` +
  `|${FUNCTION_LIMIT_TEMPLATE_SOURCE}` +
  `|${DIGITAL_PRINT_DIFFERENCE_ITEM_SOURCE})`;

/**
 * 定型注意書き1件。ストアの決まった文面そのものに一致した部分だけを消す。
 * 任意文字の幅は持たせず、言い回しを列挙する。
 * 始まりは「直前の目印の連なり」か「文頭・句読点・開き括弧の直後」に限り、
 * 終わりは「空白1つ＋句点」「文末」「閉じ括弧」に限る。目印とテンプレートの間の
 * 空白（正規化後の半角スペース）も一緒に消す。
 */
const BOILERPLATE_TEMPLATE_SOURCE =
  `(?:${NOTICE_MARKER_PREFIX_SOURCE}\\s*${BOILERPLATE_ITEM_SOURCE}` +
  `|${BOILERPLATE_START_SOURCE}${BOILERPLATE_ITEM_SOURCE})`;

const BOILERPLATE_TEMPLATE_PATTERN = new RegExp(BOILERPLATE_TEMPLATE_SOURCE, 'g');

/**
 * 除去したテンプレートを一時的に置く印。入力の制御文字はこの段階より前に消しているため、
 * 本文中の文字と衝突しない。
 */
const REMOVED_TEMPLATE_MARK = '\u0001';

/**
 * 中身がテンプレート（除去済みの印）と空白だけの括弧。括弧ごと消す。
 * 元から空の括弧（`print()` など）を消さないよう、印を1つ以上含むことを条件にする。
 */
const TEMPLATE_ONLY_BRACKET_CONTENT_SOURCE =
  `\\s*${REMOVED_TEMPLATE_MARK}[${REMOVED_TEMPLATE_MARK}\\s]*`;
const TEMPLATE_ONLY_BRACKET_PATTERN = new RegExp(
  `（${TEMPLATE_ONLY_BRACKET_CONTENT_SOURCE}）` +
    `|\\(${TEMPLATE_ONLY_BRACKET_CONTENT_SOURCE}\\)` +
    `|［${TEMPLATE_ONLY_BRACKET_CONTENT_SOURCE}］` +
    `|【${TEMPLATE_ONLY_BRACKET_CONTENT_SOURCE}】`,
  'g',
);

/** 入れ子の括弧を外側から順に片付けるための最大回数。 */
const MAX_BRACKET_STRIP_PASSES = 3;

/**
 * 内容紹介の整形。
 * タグ除去 → エンティティデコード → 再度タグ除去（`&lt;b&gt;` 由来のタグを消す）
 * → 制御文字除去 → 空白正規化 → 電子書籍ストア由来の定型注意書きの除去
 * → 空白の再正規化 → 最大 1,000 コードポイント。空になったら null。
 * 注意書きは切り詰めの前に取り除くので、本来の紹介文が多く残る。
 */
export function formatDescription(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutTags = removeHtmlTags(value);
  const decoded = decodeEntities(withoutTags);
  const withoutDecodedTags = removeHtmlTags(decoded);
  const withoutControlChars = withoutDecodedTags
    .replace(CONTROL_CHAR_PATTERN, '')
    .replace(LONE_SURROGATE_PATTERN, '');
  const normalized = withoutControlChars.replace(WHITESPACE_PATTERN, ' ').trim();
  if (normalized === '') return null;
  const stripped = stripEbookBoilerplate(normalized).replace(WHITESPACE_PATTERN, ' ').trim();
  if (stripped === '') return null;
  const codePoints = [...stripped];
  const truncated =
    codePoints.length > MAX_DESCRIPTION_CODE_POINTS
      ? codePoints.slice(0, MAX_DESCRIPTION_CODE_POINTS).join('').trimEnd()
      : stripped;
  return truncated === '' ? null : truncated;
}

/**
 * 電子書籍ストア由来の定型注意書きを、決まった文面に一致した部分だけ取り除く。
 * テンプレートに含まれない言い回しは残すので、未知の注意書きが残っても本文は消さない。
 * 目印はテンプレートと一緒にだけ消し、`【入門】` のような普通の見出しは残す。
 * 中身がテンプレートと空白だけの括弧は括弧ごと消し、括弧の外の本文には触れない。
 * 入れ子の括弧（`（［※…］）` など）は、内側から順に最大 `MAX_BRACKET_STRIP_PASSES` 回片付ける。
 */
function stripEbookBoilerplate(text: string): string {
  let current = text.replace(BOILERPLATE_TEMPLATE_PATTERN, REMOVED_TEMPLATE_MARK);
  for (let pass = 0; pass < MAX_BRACKET_STRIP_PASSES; pass += 1) {
    // 片付けた括弧も印に置き換え、外側の括弧をもう一度判定できるようにする。
    const next = current.replace(TEMPLATE_ONLY_BRACKET_PATTERN, REMOVED_TEMPLATE_MARK);
    if (next === current) break;
    current = next;
  }
  return current.split(REMOVED_TEMPLATE_MARK).join('');
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
