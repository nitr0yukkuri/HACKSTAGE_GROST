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

export const BOOKS: Book[] = [
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
