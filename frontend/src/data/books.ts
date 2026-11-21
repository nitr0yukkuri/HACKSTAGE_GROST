import type { Book } from '../types/hoshirube'

type DemoCover = { googleBooksId: string } | { imageUrl: string }

const DEMO_COVERS: Record<string, DemoCover> = {
  sophie: { imageUrl: 'https://nhkbook.s3-ap-northeast-1.amazonaws.com/image/goods/000000802231995/000000802231995_01_580.jpg' },
  ennui: { imageUrl: 'https://www.shinchosha.co.jp/images_v2/book/cover/103541/103541_xl.jpg' },
  sapiens: { googleBooksId: '9r8_DwAAQBAJ' },
  factfulness: { googleBooksId: 'POijDwAAQBAJ' },
  universe: { imageUrl: 'https://dvs-cover.kodansha.co.jp/0000194760/LYGyW1RCYA0RkKJgsPEkdCW7xqpkiDYuJPX7jhVn.jpg' },
  pragmatic: { googleBooksId: 'B5IIEAAAQBAJ' },
  readable: { imageUrl: 'https://www.oreilly.co.jp/books/images/picture_large978-4-87311-565-8.jpeg' },
  crypto: { googleBooksId: 'VQeGCgAAQBAJ' },
  engineer: { imageUrl: 'https://b-bunshun.ismcdn.jp/mwimgs/c/3/350/img_c375298c559c9d9254d330c01c66f3921311938.jpg' },
  design: { imageUrl: 'https://img.hanmoto.com/bd/img/9784788514348.jpg?lastupdated=2015-12-10T16%3A12%3A26%2B09%3A00' },
  art: { imageUrl: 'https://www.kawade.co.jp/img/cover_l/9784309256283.jpg' },
  lang: { imageUrl: 'https://www.hayakawa-online.co.jp/img/goods/L/613930.jpg' },
  ginga: { imageUrl: 'https://www.shinchosha.co.jp/images_v2/book/cover/109205/109205_xl.jpg' },
}

const demoCoverUrl = (cover: DemoCover | undefined): string | null => {
  if (!cover) return null
  return 'googleBooksId' in cover
    ? 'https://books.google.com/books/content?id=' + encodeURIComponent(cover.googleBooksId) + '&printsec=frontcover&img=1&zoom=2&source=gbs_api'
    : cover.imageUrl
}

// ローカルデモ用の固定データ。実在する書籍の表紙画像を表示する。
const demoBook = (id: string, title: string, author: string, description: string, worldIds: string[]): Book => ({
  id,
  source: 'local_demo',
  title,
  authors: author ? [author] : [],
  coverUrl: demoCoverUrl(DEMO_COVERS[id]),
  description,
  recommendationReason: null,
  infoUrl: null,
  worldIds,
})

export const BOOKS: Book[] = [
  demoBook('philosophy', '哲学の教科書', '中島義道', '哲学的に考えることへの入口', ['phi', 'phi-intro']),
  demoBook('guns', '銃・病原菌・鉄', 'ジャレド・ダイアモンド', '人類社会の発展と地域差を考える', ['his']),
  demoBook('thinking', 'ファスト＆スロー', 'ダニエル・カーネマン', '人間の判断と認知のしくみを学ぶ', ['soc']),
  demoBook('cosmos', 'コスモス', 'カール・セーガン', '宇宙と科学の壮大な世界を探る', ['sci']),
  demoBook('code', 'CODE コードから見たコンピュータのからくり', 'チャールズ・ペゾルド', 'コンピュータが動く原理を理解する', ['tec', 'tec-prog']),
  demoBook('idea', 'アイデアのつくり方', 'ジェームス・W・ヤング', '新しいアイデアが生まれる過程を学ぶ', ['mon', 'mon-think']),
  demoBook('artstory', '13歳からのアート思考', '末永幸歩', '自分なりの視点でアートを楽しむ', ['art']),
  demoBook('language', 'ことばと思考', '今井むつみ', '言葉が人の思考に与える影響を考える', ['lan']),
  demoBook('kokoro', 'こころ', '夏目漱石', '人間の心と関係性を描く小説', ['lit']),
  demoBook('sophie', 'ソフィーの世界', 'ヨースタイン・ゴルデル', '物語で哲学の歴史をたどる', ['phi', 'phi-intro']),
  demoBook('ennui', '暇と退屈の倫理学', '國分功一郎', '退屈との付き合い方を考える', ['phi-ethics']),
  demoBook('sapiens', 'サピエンス全史', 'ユヴァル・ノア・ハラリ', '人類の歩みを大きくつかむ', ['his']),
  demoBook('factfulness', 'ファクトフルネス', 'ハンス・ロスリングほか', 'データで世界を見直す', ['soc']),
  demoBook('universe', '宇宙になぜ我々が存在するのか', '村山斉', '素粒子と宇宙の謎に迫る', ['sci']),
  demoBook('pragmatic', '達人プログラマー', 'Andrew Hunt、David Thomas', 'ソフトウェアづくりの心得', ['tec', 'tec-prog']),
  demoBook('readable', 'リーダブルコード', 'Dustin Boswell、Trevor Foucher', '読みやすいコードの書き方', ['tec-prog']),
  demoBook('crypto', '暗号技術入門', '結城浩', '暗号のしくみをやさしく学ぶ', ['tec', 'tec-sec']),
  demoBook('engineer', '世界一流エンジニアの思考法', '牛尾剛', 'つくる人の考え方と視点', ['mon', 'mon-think']),
  demoBook('design', '誰のためのデザイン？', 'D.A.ノーマン', '使いやすさの本質を知る', ['mon', 'mon-design']),
  demoBook('art', '美術の物語', 'E.H.ゴンブリッチ', '美術の流れをひとつの物語に', ['art']),
  demoBook('lang', '言語が違えば、世界も違って見えるわけ', 'ガイ・ドイッチャー', '言葉と認識の関係を探る', ['lan']),
  demoBook('ginga', '銀河鉄道の夜', '宮沢賢治', '星をめぐる幻想の旅', ['lit']),
]