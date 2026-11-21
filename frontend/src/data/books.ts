import { GENRE_SAMPLE_BOOKS } from './genre-sample-books'
import type { Book } from '../types/hoshirube'

// ローカルデモ用の固定データ。API応答と同じ表示形式へ変換している。
const demoBook = (id: string, title: string, author: string, description: string, worldIds: string[]): Book => ({
  id,
  source: 'local_demo',
  title,
  authors: author ? [author] : [],
  coverUrl: null,
  description,
  recommendationReason: null,
  infoUrl: null,
  worldIds,
})

const ORIGINAL_BOOKS: Book[] = [
  demoBook('philosophy', '哲学の教科書', '中島義道', '哲学的に考えることへの入口', ['phi', 'phi-intro']),
  demoBook('guns', '銃・病原菌・鉄', 'ジャレド・ダイアモンド', '人類社会の発展と地域差を考える', ['his', 'his-world']),
  demoBook('thinking', 'ファスト＆スロー', 'ダニエル・カーネマン', '人間の判断と認知のしくみを学ぶ', ['soc', 'soc-psych']),
  demoBook('cosmos', 'コスモス', 'カール・セーガン', '宇宙と科学の壮大な世界を探る', ['sci', 'sci-space']),
  demoBook('code', 'CODE コードから見たコンピュータのからくり', 'チャールズ・ペゾルド', 'コンピュータが動く原理を理解する', ['tec', 'tec-prog']),
  demoBook('idea', 'アイデアのつくり方', 'ジェームス・W・ヤング', '新しいアイデアが生まれる過程を学ぶ', ['mon', 'mon-think']),
  demoBook('artstory', '13歳からのアート思考', '末永幸歩', '自分なりの視点でアートを楽しむ', ['art', 'art-visual']),
  demoBook('language', 'ことばと思考', '今井むつみ', '言葉が人の思考に与える影響を考える', ['lan', 'lan-linguistics']),
  demoBook('kokoro', 'こころ', '夏目漱石', '人間の心と関係性を描く小説', ['lit', 'lit-fiction']),
  demoBook('sophie', 'ソフィーの世界', 'ヨースタイン・ゴルデル', '物語で哲学の歴史をたどる', ['phi', 'phi-intro']),
  demoBook('ennui', '暇と退屈の倫理学', '國分功一郎', '退屈との付き合い方を考える', ['phi-ethics']),
  demoBook('sapiens', 'サピエンス全史', 'ユヴァル・ノア・ハラリ', '人類の歩みを大きくつかむ', ['his', 'his-world']),
  demoBook('factfulness', 'ファクトフルネス', 'ハンス・ロスリングほか', 'データで世界を見直す', ['soc', 'soc-systems']),
  demoBook('universe', '宇宙になぜ我々が存在するのか', '村山斉', '素粒子と宇宙の謎に迫る', ['sci', 'sci-space']),
  demoBook('pragmatic', '達人プログラマー', 'Andrew Hunt、David Thomas', 'ソフトウェアづくりの心得', ['tec', 'tec-prog']),
  demoBook('readable', 'リーダブルコード', 'Dustin Boswell、Trevor Foucher', '読みやすいコードの書き方', ['tec-prog']),
  demoBook('crypto', '暗号技術入門', '結城浩', '暗号のしくみをやさしく学ぶ', ['tec', 'tec-sec']),
  demoBook('engineer', '世界一流エンジニアの思考法', '牛尾剛', 'つくる人の考え方と視点', ['mon', 'mon-think']),
  demoBook('design', '誰のためのデザイン？', 'D.A.ノーマン', '使いやすさの本質を知る', ['mon', 'mon-design']),
  demoBook('art', '美術の物語', 'E.H.ゴンブリッチ', '美術の流れをひとつの物語に', ['art', 'art-visual']),
  demoBook('lang', '言語が違えば、世界も違って見えるわけ', 'ガイ・ドイッチャー', '言葉と認識の関係を探る', ['lan', 'lan-linguistics']),
  demoBook('ginga', '銀河鉄道の夜', '宮沢賢治', '星をめぐる幻想の旅', ['lit', 'lit-fiction']),
]

const normalizeTitle = (title: string): string =>
  title.normalize('NFKC').toLowerCase().replace(/\s+/g, '')

// 既存の書籍を優先し、同名のサンプル書籍は分類情報だけ統合する。
const mergedBooks = new Map<string, Book>()

for (const book of [...ORIGINAL_BOOKS, ...GENRE_SAMPLE_BOOKS]) {
  const key = normalizeTitle(book.title)
  const existing = mergedBooks.get(key)

  if (existing) {
    mergedBooks.set(key, {
      ...existing,
      worldIds: [...new Set([...existing.worldIds, ...book.worldIds])],
    })
  } else {
    mergedBooks.set(key, book)
  }
}

export const BOOKS: Book[] = [...mergedBooks.values()]
