import type { Tier, World } from '../types/hoshirube'

export const STAR_TIERS = [
  { name: '三等星', description: 'それ以外の星' },
  { name: '二等星', description: '水色の星' },
  { name: '一等星', description: '黄色の星' },
] as const

export const TIER_LABEL = STAR_TIERS.map(({ name, description }) => `${name} · ${description}`)

/** 等級は描画色と同じ状態から決める。完読は黄色、未完読のつながり先は選択中も水色。 */
export function starTiersFor(
  worlds: readonly Pick<World, 'id' | 'level'>[],
  completedWorldIds: ReadonlySet<string>,
  syncTargetIds: ReadonlySet<string>,
  selectedId: string | null,
): Record<string, Tier> {
  return Object.fromEntries(worlds.map((world): [string, Tier] => [
    world.id,
    completedWorldIds.has(world.id) ? 2
      : syncTargetIds.has(world.id) ? 1
        : world.id === selectedId ? 2
          : world.level === 2 ? 1 : 0,
  ]))
}
