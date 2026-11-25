import type { Scores, Tier, World } from '../types/hoshirube'

export const STAR_TIERS = [
  { name: '三等星', description: 'それ以外の星' },
  { name: '二等星', description: '水色の星' },
  { name: '一等星', description: '黄色の星' },
] as const

export const TIER_LABEL = STAR_TIERS.map(({ name, description }) => `${name} · ${description}`)

const tierForScore = (score: number): Tier => score >= 3 ? 2 : score >= 1 ? 1 : 0

/** 色は質問回答のスコアから決め、星をクリックしても等級は変えない。 */
export function starTiersFor(
  worlds: readonly Pick<World, 'id' | 'level' | 'parentId'>[],
  completedWorldIds: ReadonlySet<string>,
  syncTargetIds: ReadonlySet<string>,
  scores?: Scores,
  rankedThemeIds?: readonly string[],
): Record<string, Tier> {
  const apiRank = new Map<string, Tier>()
  rankedThemeIds?.forEach((id, index) => apiRank.set(id, index === 0 ? 2 : 1))

  return Object.fromEntries(worlds.map((world): [string, Tier] => [
    world.id,
    completedWorldIds.has(world.id) ? 2
      : syncTargetIds.has(world.id) ? 1
        : rankedThemeIds
          ? apiRank.get(world.parentId ?? world.id) ?? 0
          : scores
            ? tierForScore(scores[world.parentId ?? world.id] ?? 0)
            : world.level === 2 ? 1 : 0,
  ]))
}
