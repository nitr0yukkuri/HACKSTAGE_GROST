import type { Book } from '../types/hoshirube'

// ローカルモック。紹介文は仮のものなので差し替えてください
export const BOOKS: Book[] = [
  { id: 'philosophy', title: '哲学の教科書', author: '中島義道', description: '哲学的に考えることへの入口', worldIds: ['phi', 'phi-intro'] },
  { id: 'guns', title: '銃・病原菌・鉄', author: 'ジャレド・ダイアモンド', description: '人類社会の発展と地域差を考える', worldIds: ['his'] },
  { id: 'thinking', title: 'ファスト＆スロー', author: 'ダニエル・カーネマン', description: '人間の判断と認知のしくみを学ぶ', worldIds: ['soc'] },
  { id: 'cosmos', title: 'コスモス', author: 'カール・セーガン', description: '宇宙と科学の壮大な世界を探る', worldIds: ['sci'] },
  { id: 'code', title: 'CODE コードから見たコンピュータのからくり', author: 'チャールズ・ペゾルド', description: 'コンピュータが動く原理を理解する', worldIds: ['tec', 'tec-prog'] },
  { id: 'idea', title: 'アイデアのつくり方', author: 'ジェームス・W・ヤング', description: '新しいアイデアが生まれる過程を学ぶ', worldIds: ['mon', 'mon-think'] },
  { id: 'artstory', title: '13歳からのアート思考', author: '末永幸歩', description: '自分なりの視点でアートを楽しむ', worldIds: ['art'] },
  { id: 'language', title: 'ことばと思考', author: '今井むつみ', description: '言葉が人の思考に与える影響を考える', worldIds: ['lan'] },
  { id: 'kokoro', title: 'こころ', author: '夏目漱石', description: '人間の心と関係性を描く小説', worldIds: ['lit'] },
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