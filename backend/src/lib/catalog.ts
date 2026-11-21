import onboardingV1 from '../../../contracts/questionnaires/onboarding-v1.json';
import onboardingV2 from '../../../contracts/questionnaires/onboarding-v2.json';
import themesJson from '../../../contracts/themes.json';

export interface ThemeEntry {
  id: string;
  name: string;
  parentId: string | null;
  searchQuery: string;
}

export interface QuestionOption {
  id: string;
  label: string;
}

export interface QuestionCondition {
  questionId: string;
  includesOptionId?: string;
  excludesOptionId?: string;
}

/**
 * 質問票の条件付きルール（正本）。`requiredWhen`/`forbiddenWhen` は使わず、
 * この配列だけを評価する（二重評価を避ける）。
 */
export interface ConditionalRule {
  id: string;
  when: QuestionCondition;
  then: {
    requireQuestion?: string;
    forbidQuestion?: string;
  };
}

export interface Question {
  id: string;
  prompt: string;
  selection: { min: number; max: number };
  required?: { type: string };
  exclusiveOptionIds?: string[];
  options: QuestionOption[];
  optionSource?: string;
}

export interface Questionnaire {
  version: string;
  answerLimits: { minItems: number; maxItems: number };
  questions: Question[];
  conditionalRules?: ConditionalRule[];
}

export interface AnswerView {
  questionId: string;
  prompt: string;
  options: QuestionOption[];
}

/** contracts/themes.json の15星（大ジャンル9・中ジャンル6）。 */
export const THEMES: readonly ThemeEntry[] = themesJson.themes as ThemeEntry[];

export const THEME_IDS: ReadonlySet<string> = new Set(THEMES.map((theme) => theme.id));

/** seed が選出できる大ジャンル9個。 */
export const LEVEL1_THEMES: readonly ThemeEntry[] = THEMES.filter(
  (theme) => theme.parentId === null,
);

export const LEVEL1_THEME_IDS: readonly string[] = LEVEL1_THEMES.map((theme) => theme.id);

const LEVEL1_THEME_ID_SET: ReadonlySet<string> = new Set(LEVEL1_THEME_IDS);

const THEME_BY_ID: ReadonlyMap<string, ThemeEntry> = new Map(
  THEMES.map((theme) => [theme.id, theme]),
);

export function getTheme(themeId: string): ThemeEntry | undefined {
  return THEME_BY_ID.get(themeId);
}

export function isThemeId(themeId: string): boolean {
  return THEME_IDS.has(themeId);
}

export function isLevel1ThemeId(themeId: string): boolean {
  return LEVEL1_THEME_ID_SET.has(themeId);
}

/**
 * 質問票の版ごとの定義。正本は contracts/questionnaires/<version>.json で、
 * ここでは JSON をそのまま型付けして使う（文言・ID をコードに重複定義しない）。
 */
const QUESTIONNAIRES: readonly Questionnaire[] = [
  onboardingV1 as unknown as Questionnaire,
  onboardingV2 as unknown as Questionnaire,
];

const QUESTIONNAIRE_BY_VERSION: ReadonlyMap<string, Questionnaire> = new Map(
  QUESTIONNAIRES.map((questionnaire) => [questionnaire.version, questionnaire]),
);

export function getQuestionnaire(version: string): Questionnaire | undefined {
  return QUESTIONNAIRE_BY_VERSION.get(version);
}

export function isKnownQuestionnaireVersion(version: string): boolean {
  return QUESTIONNAIRE_BY_VERSION.has(version);
}

/** 質問IDと選択肢IDを表示文言に解決する。 */
export function describeAnswers(
  questionnaire: Questionnaire,
  answers: ReadonlyArray<{ questionId: string; selectedOptionIds: string[] }>,
): AnswerView[] {
  const views: AnswerView[] = [];
  for (const answer of answers) {
    const question = questionnaire.questions.find((item) => item.id === answer.questionId);
    if (!question) continue;
    const options: QuestionOption[] = [];
    for (const optionId of answer.selectedOptionIds) {
      const option = question.options.find((item) => item.id === optionId);
      if (option) options.push(option);
    }
    views.push({ questionId: question.id, prompt: question.prompt, options });
  }
  return views;
}
