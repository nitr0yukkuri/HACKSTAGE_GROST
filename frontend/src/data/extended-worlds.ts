import type { World } from '../types/hoshirube'

// フロントエンド専用の追加分類。共有API契約には含めない。
export interface ExtendedWorldDefinition {
  parentId: string
  key: string
  name: string
  description: string
}

export const EXTENDED_WORLD_DEFINITIONS: ExtendedWorldDefinition[] = [
  { parentId: 'phi', key: 'logic', name: '論理学', description: '筋道を立てて考える' },
  { parentId: 'phi', key: 'religion', name: '宗教', description: '信仰と人間の文化を知る' },
  { parentId: 'phi', key: 'eastern', name: '東洋思想', description: '東洋の思想に触れる' },
  { parentId: 'phi', key: 'western', name: '西洋哲学', description: '西洋の哲学をたどる' },
  { parentId: 'his', key: 'archaeology', name: '考古学', description: '遺跡や遺物から過去を知る' },
  { parentId: 'his', key: 'biography', name: '人物・伝記', description: '歴史を動かした人々を知る' },
  { parentId: 'his', key: 'geography', name: '地理', description: '地域と人々の暮らしを知る' },
  { parentId: 'his', key: 'culture', name: '文化史', description: '文化の移り変わりをたどる' },
  { parentId: 'soc', key: 'economics', name: '経済', description: 'お金と経済のしくみを知る' },
  { parentId: 'soc', key: 'politics', name: '政治', description: '政治と社会の関係を考える' },
  { parentId: 'soc', key: 'law', name: '法律', description: '社会のルールを知る' },
  { parentId: 'soc', key: 'education', name: '教育', description: '学びと教育のあり方を考える' },
  { parentId: 'soc', key: 'welfare', name: '福祉', description: '人々の暮らしを支えるしくみを知る' },
  { parentId: 'sci', key: 'math', name: '数学', description: '数と論理の世界を探る' },
  { parentId: 'sci', key: 'physics', name: '物理学', description: '自然界の法則を探る' },
  { parentId: 'sci', key: 'chemistry', name: '化学', description: '物質の性質と変化を知る' },
  { parentId: 'sci', key: 'earth', name: '地球科学', description: '地球と自然環境を知る' },
  { parentId: 'sci', key: 'medicine', name: '医学', description: '人体と健康の科学を知る' },
  { parentId: 'tec', key: 'ai', name: 'AI', description: '人工知能のしくみを知る' },
  { parentId: 'tec', key: 'network', name: 'ネットワーク', description: '通信を支える技術を知る' },
  { parentId: 'tec', key: 'systems', name: '情報システム', description: '情報を扱うしくみを知る' },
  { parentId: 'tec', key: 'robotics', name: 'ロボティクス', description: 'ロボットの技術を探る' },
  { parentId: 'tec', key: 'data', name: 'データサイエンス', description: 'データから発見する' },
  { parentId: 'mon', key: 'architecture', name: '建築', description: '建物と空間をつくる' },
  { parentId: 'mon', key: 'mechanical', name: '機械', description: '機械のしくみを知る' },
  { parentId: 'mon', key: 'electronics', name: '電子工作', description: '電子回路で形にする' },
  { parentId: 'mon', key: 'cooking', name: '料理', description: '食と調理の世界を知る' },
  { parentId: 'mon', key: 'craft', name: '工芸', description: '手仕事とものづくりを楽しむ' },
  { parentId: 'art', key: 'film', name: '映画', description: '映像表現の世界を知る' },
  { parentId: 'art', key: 'photo', name: '写真', description: '写真による表現を知る' },
  { parentId: 'art', key: 'anime', name: 'アニメ', description: 'アニメーションの世界を探る' },
  { parentId: 'art', key: 'manga', name: '漫画', description: '漫画の表現と文化を知る' },
  { parentId: 'art', key: 'theater', name: '演劇', description: '舞台芸術の世界を知る' },
  { parentId: 'lan', key: 'japanese', name: '日本語', description: '日本語の特徴を知る' },
  { parentId: 'lan', key: 'english', name: '英語', description: '英語の世界を広げる' },
  { parentId: 'lan', key: 'translation', name: '翻訳', description: '言葉を越えて伝える' },
  { parentId: 'lan', key: 'communication', name: 'コミュニケーション', description: '言葉で人とつながる' },
  { parentId: 'lan', key: 'writing', name: '語源・文字', description: '文字と言葉の歴史を知る' },
  { parentId: 'lit', key: 'sf', name: 'SF', description: '科学と想像力の物語を楽しむ' },
  { parentId: 'lit', key: 'mystery', name: 'ミステリー', description: '謎解きの物語を楽しむ' },
  { parentId: 'lit', key: 'fantasy', name: 'ファンタジー', description: '幻想世界の物語を楽しむ' },
  { parentId: 'lit', key: 'essay', name: 'エッセイ', description: '日常と思索の文章を楽しむ' },
  { parentId: 'lit', key: 'children', name: '児童文学', description: '子どものための物語を知る' },
]

// 追加分類は既存の大ジャンルを親として配置する。
// 検索クエリは当面親ジャンルのものを継承する。
export function createExtendedWorlds(parents: World[]): World[] {
  const parentMap = new Map(parents.map((world) => [world.id, world]))
  const counts = new Map<string, number>()

  return EXTENDED_WORLD_DEFINITIONS.map((definition) => {
    const parent = parentMap.get(definition.parentId)
    if (!parent) throw new Error(`Missing parent world: ${definition.parentId}`)

    const index = counts.get(parent.id) ?? 0
    counts.set(parent.id, index + 1)

    const angle = index * 2.399963229728653
    const radius = 0.35 + Math.sqrt(index) * 0.12

    return {
      id: `${parent.id}-${definition.key}`,
      name: definition.name,
      description: definition.description,
      searchQuery: parent.searchQuery,
      level: 2,
      parentId: parent.id,
      position: {
        x: parent.position.x + Math.cos(angle) * radius,
        y: parent.position.y + Math.sin(angle) * radius,
      },
      color: parent.color,
    }
  })
}
