import type { Book } from '../types/hoshirube'

// ローカルモック。紹介文は仮のものなので差し替えてください
export const BOOKS: Book[] = [
  { id: 'sophie', title: 'ソフィーの世界', author: 'ヨースタイン・ゴルデル', description: '物語で哲学の歴史をたどる', worldIds: ['phi', 'phi-intro'] },
  { id: 'ennui', title: '暇と退屈の倫理学', author: '國分功一郎', description: '退屈との付き合い方を考える', worldIds: ['phi-ethics'] },
  { id: 'sapiens', title: 'サピエンス全史', author: 'ユヴァル・ノア・ハラリ', description: '人類の歩みを大きくつかむ', worldIds: ['his'] },
  { id: 'factfulness', title: 'ファクトフルネス', author: 'ハンス・ロスリングほか', description: 'データで世界を見直す', worldIds: ['soc'] },
  { id: 'universe', title: '宇宙になぜ我々が存在するのか', author: '村山斉', description: '素粒子と宇宙の謎に迫る', worldIds: ['sci'] },
  { id: 'pragmatic', title: '達人プログラマー', author: 'Andrew Hunt、David Thomas', description: 'ソフトウェアづくりの心得', worldIds: ['tec', 'tec-prog'] },
  { id: 'readable', title: 'リーダブルコード', author: 'Dustin Boswell、Trevor Foucher', description: '読みやすいコードの書き方', worldIds: ['tec-prog'] },
  { id: 'crypto', title: '暗号技術入門', author: '結城浩', description: '暗号のしくみをやさしく学ぶ', worldIds: ['tec', 'tec-sec'] },
  { id: 'engineer', title: '世界一流エンジニアの思考法', author: '牛尾剛', description: 'つくる人の考え方と視点', worldIds: ['mon', 'mon-think'] },
  { id: 'design', title: '誰のためのデザイン？', author: 'D.A.ノーマン', description: '使いやすさの本質を知る', worldIds: ['mon', 'mon-design'] },
  { id: 'art', title: '美術の物語', author: 'E.H.ゴンブリッチ', description: '美術の流れをひとつの物語に', worldIds: ['art'] },
  { id: 'lang', title: '言語が違えば、世界も違って見えるわけ', author: 'ガイ・ドイッチャー', description: '言葉と認識の関係を探る', worldIds: ['lan'] },
  { id: 'ginga', title: '銀河鉄道の夜', author: '宮沢賢治', description: '星をめぐる幻想の旅', worldIds: ['lit'] },
]
