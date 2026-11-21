/**
 * モデル出力テキストから JSON を取り出す。
 * 通常は Bedrock の tool use（converseJson）でパース済みのオブジェクトを受け取る。
 * このパーサーは、tool use が返らなかったときのフォールバックと、
 * テキストしか返さないモデル・テスト用の寛容な読み取りに使う。
 */

export type ModelOutputKind = 'empty' | 'not_json';

export class ModelOutputError extends Error {
  readonly kind: ModelOutputKind;

  constructor(kind: ModelOutputKind, message?: string) {
    super(message ?? (kind === 'empty' ? 'empty model output' : 'model output is not JSON'));
    this.name = 'ModelOutputError';
    this.kind = kind;
  }
}

export function parseModelJson(text: string): unknown {
  if (typeof text !== 'string' || text.trim() === '') {
    throw new ModelOutputError('empty');
  }
  const trimmed = text.trim();
  const withoutFence = stripCodeFence(trimmed);
  const candidates = [
    trimmed,
    withoutFence,
    sliceOuterObject(trimmed),
    sliceOuterObject(withoutFence),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // 次の候補を試す
    }
  }
  // 全候補が失敗した場合に限り、閉じフェンス済みの本文が `{` 始まり `]` 終わりなら
  // 外側の `}` が1文字だけ欠けた形とみなして補う（Nova 2 Lite で観測）。
  // それ以外の修復（`]` 補完・文字列閉じ・複数 `}` など）は行わない。
  const recoverable = stripCodeFence(trimmed).trim();
  if (recoverable.startsWith('{') && recoverable.endsWith(']')) {
    try {
      return JSON.parse(`${recoverable}}`) as unknown;
    } catch {
      // 復旧できなければ次の復旧を試す
    }
  }

  // 観測された形（Nova 2 Lite、seed の生出力）: 配列要素の区切り `},` の直後に
  // 余分な `"` が1文字入る。
  // 例: {"themes":[{"themeId":"sci","searchQuery":"宇宙 謎"}," {"themeId":"art",...}]}
  // 既存の候補と外側 `}` の補完で読めない場合に限り、`}," {` の余分な引用符を
  // `},` に置き換えて厳密に読む。置換は最上位の配列（最初の `[` から最後の `]`）の
  // 中だけに限定し、配列の外の正当なプロパティを巻き込まない。
  const withoutStrayQuote = correctStrayQuotesInFirstArray(recoverable);
  if (withoutStrayQuote !== recoverable) {
    try {
      return JSON.parse(withoutStrayQuote) as unknown;
    } catch {
      // 外側 `}` も欠けた複合形だけ、既存と同じ規則を1回だけ適用する。
      if (withoutStrayQuote.startsWith('{') && withoutStrayQuote.endsWith(']')) {
        try {
          return JSON.parse(`${withoutStrayQuote}}`) as unknown;
        } catch {
          // 復旧できなければ元の例外を投げる
        }
      }
    }
  }

  throw new ModelOutputError('not_json');
}

export function stripCodeFence(text: string): string {
  if (!text.startsWith('```')) return text;
  const withoutOpen = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, '');
  return withoutOpen.replace(/\s*```\s*$/, '').trim();
}

/**
 * 配列要素間の余分な `"` を `},` に直す。
 * 置換は最上位の配列（最初の `[` から最後の `]`）の中だけに限定し、
 * それより前後のプロパティ（例 `{"kind":"themes","themes":[...]}`）は変更しない。
 */
function correctStrayQuotesInFirstArray(text: string): string {
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart < 0 || arrayEnd <= arrayStart) return text;
  const array = text.slice(arrayStart, arrayEnd + 1);
  const corrected = array.replace(/\}\s*,\s*"\s*(?=\{)/g, '},');
  if (corrected === array) return text;
  return text.slice(0, arrayStart) + corrected + text.slice(arrayEnd + 1);
}

function sliceOuterObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}
