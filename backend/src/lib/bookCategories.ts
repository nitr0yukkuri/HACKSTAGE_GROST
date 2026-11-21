const CATEGORY_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/philosophy|religion|哲学|宗教/u, 'phi'],
  [/history|biography|geography|歴史|伝記|地理/u, 'his'],
  [/computer|programming|software|internet|technology|コンピュータ|プログラミング|ソフトウェア|技術/u, 'tec'],
  [/design|architecture|engineering|デザイン|建築|工学/u, 'mon'],
  [/\b(art|arts|music|photography|painting)\b|美術|芸術|音楽|写真/u, 'art'],
  [/language|linguistics|language arts|言語|言語学/u, 'lan'],
  [/fiction|literature|poetry|drama|comics|小説|文学|詩|演劇|漫画/u, 'lit'],
  [/social science|sociology|politics|economics|education|社会|政治|経済|教育/u, 'soc'],
  [/science|physics|astronomy|mathematics|biology|chemistry|科学|物理|天文|数学|生物|化学/u, 'sci'],
];

/** Google Booksのカテゴリを、探索画面で使う星IDへ対応づける。 */
export function worldIdsForCategories(categories: readonly string[]): string[] {
  const joined = categories.join(' ').toLocaleLowerCase();
  const match = CATEGORY_RULES.find(([pattern]) => pattern.test(joined));
  return match ? [match[1]] : [];
}
