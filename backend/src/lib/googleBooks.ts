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
 * 文の区切り。句点「。」の直後で区切る（「。」は前の文に含める）。
 * 末尾に句点がなくても最後の断片は1つの文として扱う。
 */
const SENTENCE_BOUNDARY_PATTERN = /(?<=。)/;

/**
 * 注意書きの目印の直前で区切る。連続する目印は先頭の直前だけで区切る（R3）。
 * 実データでは「…最適の一冊 ※この電子書籍は…」のようにキャッチコピーの直後（句点なし）に
 * 目印が続くため、目印を文の開始として扱い、キャッチコピーを巻き込んで消さない。
 * 除去しなかった場合は区切った文字列をそのまま連結するので、本文は変化しない。
 * `【…注意…】` は長さを制限して走査量を抑える（R4）。
 */
const NOTICE_MARKER_BOUNDARY_PATTERN =
  /(?<![※＊】])(?=※|＊|【[^】]{0,20}注意[^】]{0,20}】)/;

/** 文頭の注意書きの目印。判定には目印の有無だけを使う（R4 の長さ制限込み）。 */
const NOTICE_MARKER_PREFIX_PATTERN = /^(?:※|＊|【[^】]{0,20}注意[^】]{0,20}】)/;

/** 除去で空になった括弧だけを片付けるための対応表（開き → 閉じ）。 */
const BRACKET_PAIRS: Readonly<Record<string, string>> = {
  '（': '）',
  '(': ')',
  '【': '】',
  '［': '］',
};
/** 開き括弧。 */
const OPENING_BRACKETS: ReadonlySet<string> = new Set(Object.keys(BRACKET_PAIRS));
/** 閉じ括弧。 */
const CLOSING_BRACKETS: ReadonlySet<string> = new Set(['）', ')', '】', '］']);
/** 空白1文字（全角空白を含む）。 */
const SPACE_CHAR_PATTERN = /\s/;

/**
 * A. 電子書籍の端末・レイアウトの注意の主語。商品・電子書籍・電子版は目印なしでも対象。
 * 作品・書籍は本文の文と紛らわしいので、目印がある場合だけ対象にする（R1）。
 */
const DEVICE_NOTICE_SUBJECT_PATTERN = /(?:この|本)(?:商品|電子書籍|電子版)は/;
const DEVICE_NOTICE_MARKED_SUBJECT_PATTERN = /(?:この|本)(?:作品|書籍)は/;
/** A. 主語の後に現れれば端末・レイアウトの注意と分かる語。 */
const DEVICE_NOTICE_TERM_PATTERN = /タブレット|ディスプレイ|端末|固定レイアウト|リフロー/;
/** A. 注意書きの述語。端末語と同時に現れるときだけ端末の注意と判定する（R1）。 */
const NOTICE_PREDICATE_PATTERN = /適して|配信|作成され|閲覧|お読み|ご覧|推奨/;
/** B. 機能制限の注意の語。 */
const FUNCTION_LIMIT_PATTERN = /文字だけを拡大|文字列のハイライト|辞書の参照/;
/** B. 機能制限を表す否定表現。機能語と同時に現れるときだけ対象にする（R1）。 */
const FUNCTION_LIMIT_NEGATION_PATTERN =
  /できません|(?:使用|利用)(?:でき|いただけ)ません|(?:使用|利用)できない/;
/** C. 電子版（電子書籍版）と紙版の差の注意。3条件がそろった文だけを対象にする。 */
const DIGITAL_EDITION_PATTERN = /電子書籍版|電子版/;
const PRINT_EDITION_PATTERN = /紙版|紙の書籍|紙の本|紙書籍/;
const EDITION_DIFFERENCE_PATTERN = /異な|含まれ|付属し|掲載され|収録され/;
/** C. 電子版が主語として現れる形。目印がない文でもこの形なら対象にする（R1）。 */
const DIGITAL_EDITION_SUBJECT_PATTERN = /(?:電子版|電子書籍版)(?:は|では|には)/;
/** 注意書きの直後に続く「続きの文」の語。 */
const NOTICE_CONTINUATION_PATTERN =
  /掲載されていない|収録されていない|掲載されません|収録されません|お使いの端末|立ち読みファイル|閲覧環境/;

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
 * 電子書籍ストア由来の定型注意書きを文単位で取り除く。
 * 直前の文を除去したときだけ、続きの文（「掲載されていない…」など）も連続して除去する。
 * 空白だけの断片は判定せず、続きの文の連鎖も切らない（R2）。
 * 文の一部だけを消すことはしない。除去で空になった括弧だけを片付ける（R3・R5）。
 */
function stripEbookBoilerplate(text: string): string {
  const sentences = text
    .split(SENTENCE_BOUNDARY_PATTERN)
    .flatMap((sentence) => sentence.split(NOTICE_MARKER_BOUNDARY_PATTERN))
    .filter((sentence) => sentence !== '');
  let result = '';
  let removedSinceKept = false;
  for (const sentence of sentences) {
    if (sentence.trim() === '') {
      // 空白だけの断片は出力に残し、連鎖の状態は変えない（最後に空白を正規化する）。
      result += sentence;
      continue;
    }
    const removed =
      isBoilerplateSentence(sentence) || (removedSinceKept && isContinuationSentence(sentence));
    if (removed) {
      removedSinceKept = true;
      continue;
    }
    let piece = sentence;
    if (removedSinceKept) {
      // 除去を挟んで開き括弧と閉じ括弧だけが残った場合に限り、その括弧を取り除く。
      // 本文に元からある空の括弧は対象にしない（R5）。
      const withoutBrackets = removeBracketPairAroundRemoval(result, piece);
      if (withoutBrackets !== null) {
        result = withoutBrackets.before;
        piece = withoutBrackets.after;
      }
    }
    result += piece;
    removedSinceKept = false;
  }
  return result;
}

/** 末尾の空白を無視して、開き括弧で終わっていればその位置を返す。 */
function findTrailingOpenBracket(text: string): number {
  let index = text.length - 1;
  while (index >= 0 && SPACE_CHAR_PATTERN.test(text[index] ?? '')) index -= 1;
  if (index < 0) return -1;
  return OPENING_BRACKETS.has(text[index] ?? '') ? index : -1;
}

/** 先頭の空白を無視して、閉じ括弧で始まっていればその位置を返す。 */
function findLeadingCloseBracket(text: string): number {
  let index = 0;
  while (index < text.length && SPACE_CHAR_PATTERN.test(text[index] ?? '')) index += 1;
  if (index >= text.length) return -1;
  return CLOSING_BRACKETS.has(text[index] ?? '') ? index : -1;
}

/** 除去を挟んで対応する開き・閉じ括弧だけが残っているとき、両方を取り除く。 */
function removeBracketPairAroundRemoval(
  before: string,
  after: string,
): { before: string; after: string } | null {
  const openIndex = findTrailingOpenBracket(before);
  if (openIndex < 0) return null;
  const closeIndex = findLeadingCloseBracket(after);
  if (closeIndex < 0) return null;
  const openChar = before[openIndex] ?? '';
  const closeChar = after[closeIndex] ?? '';
  if (BRACKET_PAIRS[openChar] !== closeChar) return null;
  return { before: before.slice(0, openIndex), after: after.slice(closeIndex + 1) };
}

/** A〜C のいずれかに当てはまる「注意書きの文」か。文頭の空白は無視して判定する。 */
function isBoilerplateSentence(sentence: string): boolean {
  const text = sentence.trimStart();
  if (text === '') return false;
  const marked = NOTICE_MARKER_PREFIX_PATTERN.test(text);
  if (isDeviceNotice(text, marked)) return true;
  if (FUNCTION_LIMIT_PATTERN.test(text) && FUNCTION_LIMIT_NEGATION_PATTERN.test(text)) return true;
  return (
    (marked || DIGITAL_EDITION_SUBJECT_PATTERN.test(text)) &&
    DIGITAL_EDITION_PATTERN.test(text) &&
    PRINT_EDITION_PATTERN.test(text) &&
    EDITION_DIFFERENCE_PATTERN.test(text)
  );
}

/** A. 端末・レイアウトの注意か。主語の後に端末語があり、同じ文に述語があること。 */
function isDeviceNotice(text: string, marked: boolean): boolean {
  if (matchesDeviceNotice(text, DEVICE_NOTICE_SUBJECT_PATTERN)) return true;
  return marked && matchesDeviceNotice(text, DEVICE_NOTICE_MARKED_SUBJECT_PATTERN);
}

function matchesDeviceNotice(text: string, subjectPattern: RegExp): boolean {
  const subject = subjectPattern.exec(text);
  if (!subject) return false;
  const rest = text.slice(subject.index + subject[0].length);
  return DEVICE_NOTICE_TERM_PATTERN.test(rest) && NOTICE_PREDICATE_PATTERN.test(text);
}

/** 直前の注意書きに続く「続きの文」か。 */
function isContinuationSentence(sentence: string): boolean {
  return NOTICE_CONTINUATION_PATTERN.test(sentence);
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
