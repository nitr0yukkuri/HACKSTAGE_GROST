import { createExtendedWorlds } from './extended-worlds'
import type { World } from '../types/hoshirube'
import themeCatalog from '../../../contracts/themes.json'

const SEARCH_QUERY_BY_ID = new Map(themeCatalog.themes.map((theme) => [theme.id, theme.searchQuery]))
const searchQueryFor = (id: string): string => {
  const query = SEARCH_QUERY_BY_ID.get(id)
  if (!query) throw new Error(`Missing search query for theme: ${id}`)
  return query
}

const l1 = (id: string, name: string, description: string, x: number, y: number, color: string): World =>
  ({ id, name, description, searchQuery: searchQueryFor(id), level: 1, parentId: null, position: { x, y }, color })

const WORLDS_L1: World[] = [
  l1('phi', '哲学', '当たり前を疑い、考え方そのものを見つめ直す世界', -0.9, 0.12, '#b9a8ff'),
  l1('his', '歴史', '過去の出来事から、いまの世界を読み解く', -0.6, -0.62, '#e6b980'),
  l1('soc', '社会', '人と社会のしくみを知る', -0.05, -0.75, '#7fd0c4'),
  l1('sci', '自然科学', '宇宙から物質まで、自然のしくみを探る', 0.78, 0.32, '#7fb6ff'),
  l1('tec', 'テクノロジー', 'コンピュータと情報技術の世界', 0.75, -0.55, '#8fd3ff'),
  l1('mon', 'ものづくり', 'アイデアを形にし、世界を変えていく', 0, 0, '#ffb867'),
  l1('art', '芸術', '美しさと表現の歴史にふれる', -0.7, 0.72, '#ff9fc2'),
  l1('lan', '言語', '言葉が見せる世界の違いを知る', 0.25, 0.74, '#a6e3a1'),
  l1('lit', '文学', '物語の世界に没頭する', -0.38, 0.4, '#d9a6ff'),
]

// 中ジャンル（Level 2）。親からの相対位置で配置。MVPでは3ジャンルだけ展開できる
const l2 = (parentId: string, key: string, name: string, description: string, dx: number, dy: number): World => {
  const p = WORLDS_L1.find((w) => w.id === parentId)!
  const id = `${parentId}-${key}`
  return { id, name, description, searchQuery: searchQueryFor(id), level: 2, parentId, position: { x: p.position.x + dx, y: p.position.y + dy }, color: p.color }
}

export const WORLDS: World[] = [
  ...WORLDS_L1,
  l2('phi', 'ethics', '生き方・倫理', 'どう生きるかを考える', 0.3, 0.22),
  l2('phi', 'intro', '哲学入門', 'はじめの一歩', -0.28, 0.3),
  l2('tec', 'prog', 'プログラミング', 'コードを書く力を磨く', 0.3, 0.22),
  l2('tec', 'sec', 'セキュリティ', '守る技術を知る', -0.28, 0.3),
  l2('mon', 'design', '設計とデザイン', '使う人から考える', 0.3, 0.22),
  l2('mon', 'think', 'つくる思考', 'エンジニアの考え方', -0.28, 0.3),
  // 歴史
  l2('his', 'japan', '日本史', '日本の歴史をたどる', -0.25, -0.2),
  l2('his', 'world', '世界史', '世界の歴史を探る', 0.25, -0.2),

  // 社会
  l2('soc', 'psych', '心理・人間関係', '人の心と関係性を知る', -0.25, -0.2),
  l2('soc', 'systems', '社会のしくみ', '社会を支える制度を知る', 0.25, -0.2),

  // 自然科学
  l2('sci', 'space', '宇宙・天文学', '宇宙の謎を探る', 0.25, 0.2),
  l2('sci', 'life', '生物・生命', '生命のしくみを知る', -0.25, 0.2),

  // 芸術
  l2('art', 'visual', '絵画・デザイン', '視覚表現の世界を知る', -0.25, 0.2),
  l2('art', 'music', '音楽・表現', '音と表現の世界を探る', 0.25, 0.2),

  // 言語
  l2('lan', 'linguistics', '言語学', '言葉のしくみを知る', -0.25, 0.2),
  l2('lan', 'world', '世界の言葉', '世界の多様な言語を知る', 0.25, 0.2),

  // 文学
  l2('lit', 'fiction', '小説・物語', '物語の世界を旅する', -0.25, 0.2),
  l2('lit', 'classics', '詩・古典', '時代を超えた文学を知る', 0.25, 0.2),

]

// 共有契約に登録された27分類に、フロント専用の43分類を追加。
WORLDS.push(...createExtendedWorlds(WORLDS_L1))

export const GENRES = WORLDS.filter((w) => w.level === 1)
