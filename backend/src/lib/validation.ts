import {
  getQuestionnaire,
  isKnownQuestionnaireVersion,
  type QuestionCondition,
  type Questionnaire,
} from './catalog.js';
import { AppError, ERROR_MESSAGES, type ErrorDetail } from './errors.js';

/**
 * seed 本文と GET の X-Discovery-Context で共通の回答検証。
 * 質問・選択肢・選択数・条件付き必須/禁止は contracts/questionnaires/*.json を読んで判定する。
 */

export interface ValidatedAnswer {
  questionId: string;
  selectedOptionIds: string[];
  /** リクエスト内の位置。エラーの field 表記に使う。 */
  index: number;
}

export interface ValidatedSeedInput {
  questionnaireVersion: string;
  questionnaire: Questionnaire;
  answers: ValidatedAnswer[];
}

type UnknownRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * @param input 解析済みの値（seed 本文またはヘッダーの JSON）
 * @param prefix ヘッダー検証時の field 接頭辞。例 'X-Discovery-Context'
 */
export function validateSeedInput(input: unknown, prefix = ''): ValidatedSeedInput {
  const field = (name: string): string => (prefix ? `${prefix}.${name}` : name);
  const rootField = prefix === '' ? 'body' : prefix;

  if (!isPlainObject(input)) {
    throw validationError([{ field: rootField, code: 'INVALID_REQUEST_SHAPE' }]);
  }

  const shapeErrors: ErrorDetail[] = [];
  for (const key of Object.keys(input)) {
    if (key !== 'questionnaireVersion' && key !== 'answers') {
      // キー名が空文字だと `field` が入力箇所を指せない（本文なら ''、ヘッダーなら
      // 'X-Discovery-Context.' になる）。その場合は安定した入力箇所（body / ヘッダー名）を指す。
      shapeErrors.push({
        field: key === '' ? rootField : field(key),
        code: 'INVALID_REQUEST_SHAPE',
      });
    }
  }

  const version = input.questionnaireVersion;
  if (typeof version !== 'string' || version.length === 0) {
    shapeErrors.push({ field: field('questionnaireVersion'), code: 'INVALID_REQUEST_SHAPE' });
  }
  if (!Array.isArray(input.answers)) {
    shapeErrors.push({ field: field('answers'), code: 'INVALID_REQUEST_SHAPE' });
  }
  if (shapeErrors.length > 0) throw validationError(shapeErrors);

  const questionnaireVersion = version as string;
  if (!isKnownQuestionnaireVersion(questionnaireVersion)) {
    throw new AppError(
      422,
      'UNSUPPORTED_QUESTIONNAIRE_VERSION',
      ERROR_MESSAGES.UNSUPPORTED_QUESTIONNAIRE_VERSION,
      [{ field: field('questionnaireVersion'), code: 'UNSUPPORTED_QUESTIONNAIRE_VERSION' }],
    );
  }
  const questionnaire = getQuestionnaire(questionnaireVersion) as Questionnaire;
  const rawAnswers = input.answers as unknown[];

  // 1. 各回答の形状（型・余分なプロパティ・null）
  const itemShapeErrors: ErrorDetail[] = [];
  for (let index = 0; index < rawAnswers.length; index += 1) {
    const item = rawAnswers[index];
    const base = `${field('answers')}[${index}]`;
    if (!isPlainObject(item)) {
      itemShapeErrors.push({ field: base, code: 'INVALID_REQUEST_SHAPE' });
      continue;
    }
    for (const key of Object.keys(item)) {
      if (key !== 'questionId' && key !== 'selectedOptionIds') {
        // キー名が空文字のときは `answers[0].` ではなく要素自体を指す。
        itemShapeErrors.push({
          field: key === '' ? base : `${base}.${key}`,
          code: 'INVALID_REQUEST_SHAPE',
        });
      }
    }
    if (typeof item.questionId !== 'string' || item.questionId.length === 0) {
      itemShapeErrors.push({ field: `${base}.questionId`, code: 'INVALID_REQUEST_SHAPE' });
    }
    if (!isStringArray(item.selectedOptionIds)) {
      itemShapeErrors.push({
        field: `${base}.selectedOptionIds`,
        code: 'INVALID_REQUEST_SHAPE',
      });
    }
  }
  if (itemShapeErrors.length > 0) throw validationError(itemShapeErrors);

  const answers: ValidatedAnswer[] = rawAnswers.map((item, index) => {
    const record = item as UnknownRecord;
    return {
      questionId: record.questionId as string,
      selectedOptionIds: [...(record.selectedOptionIds as string[])],
      index,
    };
  });

  // 2. 質問IDの既知性・重複（件数より先に見る。版違いの質問を送った場合に
  //    UNKNOWN_QUESTION_ID を返すため）
  const questionErrors: ErrorDetail[] = [];
  const seenQuestions = new Set<string>();
  for (const answer of answers) {
    const base = `${field('answers')}[${answer.index}]`;
    if (!questionnaire.questions.some((question) => question.id === answer.questionId)) {
      questionErrors.push({ field: `${base}.questionId`, code: 'UNKNOWN_QUESTION_ID' });
      continue;
    }
    if (seenQuestions.has(answer.questionId)) {
      questionErrors.push({ field: `${base}.questionId`, code: 'DUPLICATE_QUESTION_ID' });
      continue;
    }
    seenQuestions.add(answer.questionId);
  }
  if (questionErrors.length > 0) throw validationError(questionErrors);

  // 3. 回答件数（版ごとの上限）
  const { minItems, maxItems } = questionnaire.answerLimits;
  if (answers.length < minItems || answers.length > maxItems) {
    throw validationError([
      { field: field('answers'), code: 'ANSWERS_COUNT_OUT_OF_RANGE' },
    ]);
  }

  // 4. 選択肢（空・重複・未知・数・排他）
  const selectionErrors: ErrorDetail[] = [];
  for (const answer of answers) {
    const question = questionnaire.questions.find((item) => item.id === answer.questionId);
    if (!question) continue;
    const base = `${field('answers')}[${answer.index}].selectedOptionIds`;
    if (answer.selectedOptionIds.length === 0) {
      selectionErrors.push({ field: base, code: 'EMPTY_SELECTION' });
      continue;
    }
    const seenOptions = new Set<string>();
    for (const optionId of answer.selectedOptionIds) {
      if (seenOptions.has(optionId)) {
        selectionErrors.push({ field: base, code: 'DUPLICATE_OPTION_ID' });
      }
      seenOptions.add(optionId);
    }
    for (const optionId of seenOptions) {
      if (!question.options.some((option) => option.id === optionId)) {
        selectionErrors.push({ field: base, code: 'UNKNOWN_OPTION_ID' });
      }
    }
    const count = seenOptions.size;
    if (count < question.selection.min || count > question.selection.max) {
      selectionErrors.push({ field: base, code: 'SELECTION_COUNT_OUT_OF_RANGE' });
    }
    const exclusive = question.exclusiveOptionIds ?? [];
    if (count > 1 && exclusive.some((optionId) => seenOptions.has(optionId))) {
      selectionErrors.push({ field: base, code: 'EXCLUSIVE_OPTION_CONFLICT' });
    }
  }
  if (selectionErrors.length > 0) throw validationError(dedupeDetails(selectionErrors));

  // 5. 必須・条件付き必須/禁止（条件は質問票の conditionalRules を正本として評価する）
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer]));
  const ruleErrors: ErrorDetail[] = [];
  for (const question of questionnaire.questions) {
    if (question.required?.type === 'always' && !byQuestion.has(question.id)) {
      ruleErrors.push({ field: field('answers'), code: 'MISSING_REQUIRED_QUESTION' });
    }
  }
  for (const rule of questionnaire.conditionalRules ?? []) {
    if (!conditionHolds(rule.when, byQuestion)) continue;
    const requiredQuestionId = rule.then.requireQuestion;
    if (requiredQuestionId !== undefined && !byQuestion.has(requiredQuestionId)) {
      ruleErrors.push({ field: field('answers'), code: 'MISSING_REQUIRED_QUESTION' });
    }
    const forbiddenQuestionId = rule.then.forbidQuestion;
    if (forbiddenQuestionId !== undefined) {
      const answer = byQuestion.get(forbiddenQuestionId);
      if (answer) {
        ruleErrors.push({
          field: `${field('answers')}[${answer.index}].questionId`,
          code: 'FORBIDDEN_QUESTION',
        });
      }
    }
  }
  if (ruleErrors.length > 0) throw validationError(ruleErrors);

  return { questionnaireVersion, questionnaire, answers };
}

function conditionHolds(
  condition: QuestionCondition,
  byQuestion: ReadonlyMap<string, ValidatedAnswer>,
): boolean {
  const selected = byQuestion.get(condition.questionId)?.selectedOptionIds;
  if (!selected) return false;
  if (condition.includesOptionId !== undefined) {
    return selected.includes(condition.includesOptionId);
  }
  if (condition.excludesOptionId !== undefined) {
    return !selected.includes(condition.excludesOptionId);
  }
  return false;
}

function dedupeDetails(details: ErrorDetail[]): ErrorDetail[] {
  const seen = new Set<string>();
  const result: ErrorDetail[] = [];
  for (const detail of details) {
    const key = `${detail.field}\u0000${detail.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(detail);
  }
  return result;
}

function validationError(details: ErrorDetail[]): AppError {
  return new AppError(422, 'VALIDATION_ERROR', ERROR_MESSAGES.VALIDATION_ERROR, details);
}
