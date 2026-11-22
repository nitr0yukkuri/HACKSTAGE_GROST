import type { Book } from '../types/hoshirube'

/** 理由がない本に出す、AI を使わない定型文。本の内容には触れない。 */
export function fallbackReason(
  book: Pick<Book, 'selectedBy' | 'description' | 'infoUrl'>,
  worldName?: string,
): string {
  const star = worldName?.trim() ? `${worldName.trim()}の星` : 'この星'
  const first =
    book.selectedBy === 'search'
      ? `${star}に並ぶ一冊です。`
      : `${star}につながる一冊です。`
  const second = book.description
    ? '気になったら、内容紹介をひらいてみてください。'
    : book.infoUrl
      ? 'タイトルが気になったら、Google Books で中身をのぞいてみませんか？'
      : 'タイトルが気になったら、手に取ってみてください。'
  return `${first}${second}`
}
