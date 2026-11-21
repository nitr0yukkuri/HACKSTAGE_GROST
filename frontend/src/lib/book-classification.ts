import type { Book } from '../types/hoshirube'
import { WORLDS } from '../data/worlds'

export interface BookClassification {
  confirmedIds: string[]
  suggestedIds: string[]
}

interface Rule {
  worldId: string
  keywords: string[]
}

const RULES: Rule[] = [
  { worldId: 'tec-ai', keywords: ['人工知能', '機械学習', 'ディープラーニング'] },
  { worldId: 'tec-prog', keywords: ['プログラミング', 'プログラマー'] },
  { worldId: 'tec-sec', keywords: ['サイバーセキュリティ', '暗号技術', '情報セキュリティ'] },
  { worldId: 'tec-network', keywords: ['コンピュータネットワーク', 'ネットワーク技術'] },
  { worldId: 'tec-data', keywords: ['データサイエンス', 'データ分析'] },

  { worldId: 'sci-space', keywords: ['宇宙', '天文学', 'ブラックホール'] },
  { worldId: 'sci-math', keywords: ['数学', '数論', '微積分'] },
  { worldId: 'sci-physics', keywords: ['物理学', '量子力学', '相対性理論'] },
  { worldId: 'sci-chemistry', keywords: ['化学', '分子構造'] },
  { worldId: 'sci-life', keywords: ['生物学', '生命科学', '進化論'] },

  { worldId: 'his-japan', keywords: ['日本史', '戦国時代', '江戸時代'] },
  { worldId: 'his-world', keywords: ['世界史', '古代ローマ', '世界大戦'] },
  { worldId: 'his-archaeology', keywords: ['考古学', '遺跡発掘'] },

  { worldId: 'soc-economics', keywords: ['経済学', 'マクロ経済', 'ミクロ経済'] },
  { worldId: 'soc-politics', keywords: ['政治学', '民主主義'] },
  { worldId: 'soc-law', keywords: ['法律', '法学', '憲法'] },
  { worldId: 'soc-education', keywords: ['教育学', '教育制度'] },
  { worldId: 'soc-psych', keywords: ['心理学', '認知心理'] },

  { worldId: 'phi-ethics', keywords: ['倫理学', '倫理思想'] },
  { worldId: 'phi-logic', keywords: ['論理学', '形式論理'] },
  { worldId: 'phi-western', keywords: ['西洋哲学'] },

  { worldId: 'mon-architecture', keywords: ['建築設計', '建築学'] },
  { worldId: 'mon-electronics', keywords: ['電子工作', '電子回路'] },
  { worldId: 'mon-cooking', keywords: ['料理', '調理法', 'レシピ'] },

  { worldId: 'art-film', keywords: ['映画史', '映画制作'] },
  { worldId: 'art-photo', keywords: ['写真術', '写真撮影'] },
  { worldId: 'art-anime', keywords: ['アニメーション'] },
  { worldId: 'art-manga', keywords: ['漫画', 'マンガ'] },

  { worldId: 'lan-linguistics', keywords: ['言語学', '音韻論', '統語論'] },
  { worldId: 'lan-translation', keywords: ['翻訳技術', '翻訳論'] },

  { worldId: 'lit-sf', keywords: ['SF小説', 'サイエンスフィクション'] },
  { worldId: 'lit-mystery', keywords: ['ミステリー小説', '推理小説'] },
  { worldId: 'lit-fantasy', keywords: ['ファンタジー小説'] },
  { worldId: 'lit-essay', keywords: ['エッセイ', '随筆集'] },
]

const VALID_CHILD_IDS = new Set(
  WORLDS.filter((world) => world.level === 2).map((world) => world.id),
)

export function classifyBook(book: Book): BookClassification {
  const title = book.title.toLowerCase()
  const description = (book.description ?? '').toLowerCase()

  const explicitIds = book.worldIds.filter((id) => VALID_CHILD_IDS.has(id))

  const titleMatches = RULES
    .filter((rule) =>
      rule.keywords.some((keyword) => title.includes(keyword.toLowerCase())),
    )
    .map((rule) => rule.worldId)

  const confirmedIds = [...new Set([...explicitIds, ...titleMatches])]
    .filter((id) => VALID_CHILD_IDS.has(id))

  const descriptionMatches = RULES
    .filter((rule) =>
      rule.keywords.some((keyword) => description.includes(keyword.toLowerCase())),
    )
    .map((rule) => rule.worldId)

  const suggestedIds = [...new Set(descriptionMatches)]
    .filter((id) =>
      VALID_CHILD_IDS.has(id) && !confirmedIds.includes(id),
    )
    .slice(0, 3)

  return { confirmedIds, suggestedIds }
}
