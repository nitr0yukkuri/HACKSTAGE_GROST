import { describe, expect, it } from 'vitest';

import type { BedrockGateway } from '../src/lib/bedrock.js';
import { createBedrockGateway } from '../src/lib/bedrock.js';
import { loadConfig } from '../src/lib/config.js';
import type { LogRecord, Logger } from '../src/lib/log.js';
import { ModelOutputError } from '../src/lib/json.js';
import {
  bedrockStub,
  createHarness,
  hangingBedrock,
  parseJson,
  seedEvent,
  seedEventBase64,
  usageStub,
  V1_NONE,
  V1_NORMAL,
  V2_CURIOSITY,
  V2_NO_CURIOSITY,
} from './helpers.js';

interface ErrorBody {
  requestId: string;
  error: {
    code: string;
    message: string;
    details: Array<{ field: string; code: string }>;
  };
}

const SEED_THEMES = [
  { themeId: 'tec', searchQuery: 'プログラミング 入門' },
  { themeId: 'mon', searchQuery: 'デザイン 発想 入門' },
  { themeId: 'phi', searchQuery: '哲学 新しい視点 入門' },
];

function seedText(themes: unknown = SEED_THEMES): string {
  return JSON.stringify({ themes });
}

describe('POST /v1/discovery/seed', () => {
  it('v1 通常回答で3件の星を返す', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText()),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL, { requestId: 'req-seed-1' }));

    expect(response.statusCode).toBe(200);
    expect(response.headers['Content-Type']).toBe('application/json; charset=utf-8');
    expect(response.headers['Cache-Control']).toBe('no-store');
    const body = parseJson<{ requestId: string; themes: typeof SEED_THEMES }>(response.body);
    expect(body.requestId).toBe('req-seed-1');
    expect(body.themes).toEqual(SEED_THEMES);
    expect(harness.bedrock.calls).toHaveLength(1);
  });

  it('v1「特になし」でも3問の回答で200', async () => {
    const harness = createHarness({ bedrock: bedrockStub(() => seedText()) });
    const response = await harness.handler(seedEvent(V1_NONE));
    expect(response.statusCode).toBe(200);
  });

  it('v2 の none + curiosity で200', async () => {
    const harness = createHarness({ bedrock: bedrockStub(() => seedText()) });
    const response = await harness.handler(seedEvent(V2_CURIOSITY));
    expect(response.statusCode).toBe(200);
  });

  it('v2 の curiosity なし（interest が none 以外）で200', async () => {
    const harness = createHarness({ bedrock: bedrockStub(() => seedText()) });
    const response = await harness.handler(seedEvent(V2_NO_CURIOSITY));
    expect(response.statusCode).toBe(200);
  });

  it('AI 出力の searchQuery を trim して返す', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() =>
        seedText([
          { themeId: 'tec', searchQuery: '  プログラミング 入門  ' },
          { themeId: 'mon', searchQuery: '\tデザイン 発想\n' },
          { themeId: 'phi', searchQuery: '  哲学 入門  ' },
        ]),
      ),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    const body = parseJson<{ themes: Array<{ searchQuery: string }> }>(response.body);
    expect(body.themes.map((theme) => theme.searchQuery)).toEqual([
      'プログラミング 入門',
      'デザイン 発想',
      '哲学 入門',
    ]);
  });

  it('コードフェンス付きの AI 出力を受け付ける', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => '```json\n' + seedText() + '\n```'),
    });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
  });

  it('AI 出力の前後に説明文があっても JSON を取り出せる', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => `候補は次のとおりです。\n${seedText()}\n以上です。`),
    });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
  });

  const invalidInputs: Array<{
    name: string;
    body: unknown;
    code: string;
    field: string;
  }> = [
    {
      name: 'v1 に curiosity を送る',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['none'] },
          { questionId: 'curiosity', selectedOptionIds: ['music_emotions'] },
          { questionId: 'themes', selectedOptionIds: ['omakase'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'UNKNOWN_QUESTION_ID',
      field: 'answers[1].questionId',
    },
    {
      name: 'v2 で curiosity が欠落',
      body: {
        questionnaireVersion: 'onboarding-v2',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['none'] },
          { questionId: 'themes', selectedOptionIds: ['omakase'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'MISSING_REQUIRED_QUESTION',
      field: 'answers',
    },
    {
      name: 'v2 で interest が none 以外なのに curiosity を送る',
      body: {
        questionnaireVersion: 'onboarding-v2',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['explore_unknown'] },
          { questionId: 'curiosity', selectedOptionIds: ['city_origins'] },
          { questionId: 'themes', selectedOptionIds: ['lit'] },
          { questionId: 'reading_experience', selectedOptionIds: ['immerse_story'] },
        ],
      },
      code: 'FORBIDDEN_QUESTION',
      field: 'answers[1].questionId',
    },
    {
      name: 'omakase と個別テーマの同時選択',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['create'] },
          { questionId: 'themes', selectedOptionIds: ['omakase', 'tec'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'EXCLUSIVE_OPTION_CONFLICT',
      field: 'answers[1].selectedOptionIds',
    },
    {
      name: '未知の選択肢',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['unknown_option'] },
          { questionId: 'themes', selectedOptionIds: ['phi'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'UNKNOWN_OPTION_ID',
      field: 'answers[0].selectedOptionIds',
    },
    {
      name: '同じ質問IDの重複',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['create'] },
          { questionId: 'interest', selectedOptionIds: ['think_deeply'] },
          { questionId: 'themes', selectedOptionIds: ['phi'] },
        ],
      },
      code: 'DUPLICATE_QUESTION_ID',
      field: 'answers[1].questionId',
    },
    {
      name: '未回答を表す空配列',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: [] },
          { questionId: 'themes', selectedOptionIds: ['phi'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'EMPTY_SELECTION',
      field: 'answers[0].selectedOptionIds',
    },
    {
      name: '単一選択に2つ選ぶ',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['create'] },
          { questionId: 'themes', selectedOptionIds: ['phi'] },
          {
            questionId: 'reading_experience',
            selectedOptionIds: ['new_perspective', 'deepen_thought'],
          },
        ],
      },
      code: 'SELECTION_COUNT_OUT_OF_RANGE',
      field: 'answers[2].selectedOptionIds',
    },
    {
      name: '選択肢IDの重複',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['create'] },
          { questionId: 'themes', selectedOptionIds: ['phi', 'phi'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'DUPLICATE_OPTION_ID',
      field: 'answers[1].selectedOptionIds',
    },
    {
      name: 'themeId を本文に含める',
      body: {
        themeId: 'tec',
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['none'] },
          { questionId: 'themes', selectedOptionIds: ['omakase'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'INVALID_REQUEST_SHAPE',
      field: 'themeId',
    },
    {
      name: 'answers が配列でない',
      body: { questionnaireVersion: 'onboarding-v1', answers: {} },
      code: 'INVALID_REQUEST_SHAPE',
      field: 'answers',
    },
    {
      name: 'null を選択肢の代わりに送る',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: null },
          { questionId: 'themes', selectedOptionIds: ['phi'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'INVALID_REQUEST_SHAPE',
      field: 'answers[0].selectedOptionIds',
    },
    {
      name: '回答件数が不足',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['create'] },
          { questionId: 'themes', selectedOptionIds: ['phi'] },
        ],
      },
      code: 'ANSWERS_COUNT_OUT_OF_RANGE',
      field: 'answers',
    },
    {
      name: '未知プロパティ名が空文字',
      body: {
        '': 'x',
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { questionId: 'interest', selectedOptionIds: ['create'] },
          { questionId: 'themes', selectedOptionIds: ['phi'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'INVALID_REQUEST_SHAPE',
      field: 'body',
    },
    {
      name: '回答内の未知プロパティ名が空文字',
      body: {
        questionnaireVersion: 'onboarding-v1',
        answers: [
          { '': 'x', questionId: 'interest', selectedOptionIds: ['create'] },
          { questionId: 'themes', selectedOptionIds: ['phi'] },
          { questionId: 'reading_experience', selectedOptionIds: ['new_perspective'] },
        ],
      },
      code: 'INVALID_REQUEST_SHAPE',
      field: 'answers[0]',
    },
  ];

  for (const testCase of invalidInputs) {
    it(`422 を返し外部サービスを呼ばない: ${testCase.name}`, async () => {
      const harness = createHarness();
      const response = await harness.handler(seedEvent(testCase.body));

      expect(response.statusCode).toBe(422);
      const body = parseJson<ErrorBody>(response.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toContainEqual({
        field: testCase.field,
        code: testCase.code,
      });
      expect(harness.bedrock.calls).toHaveLength(0);
    });
  }

  it('未対応の質問票の版は 422 UNSUPPORTED_QUESTIONNAIRE_VERSION', async () => {
    const harness = createHarness();
    const response = await harness.handler(
      seedEvent({ questionnaireVersion: 'onboarding-v9', answers: [] }),
    );
    expect(response.statusCode).toBe(422);
    const body = parseJson<ErrorBody>(response.body);
    expect(body.error.code).toBe('UNSUPPORTED_QUESTIONNAIRE_VERSION');
    expect(body.error.details).toEqual([
      { field: 'questionnaireVersion', code: 'UNSUPPORTED_QUESTIONNAIRE_VERSION' },
    ]);
    expect(harness.bedrock.calls).toHaveLength(0);
  });

  it('Content-Type が JSON でなければ 415', async () => {
    const harness = createHarness();
    const response = await harness.handler(seedEvent(V1_NORMAL, { contentType: 'text/plain' }));
    expect(response.statusCode).toBe(415);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(harness.bedrock.calls).toHaveLength(0);
  });

  it('Content-Type が未指定なら 415', async () => {
    const harness = createHarness();
    const response = await harness.handler(seedEvent(V1_NORMAL, { contentType: null }));
    expect(response.statusCode).toBe(415);
  });

  it('charset 付きの application/json は受け付ける', async () => {
    const harness = createHarness({ bedrock: bedrockStub(() => seedText()) });
    const response = await harness.handler(
      seedEvent(V1_NORMAL, { contentType: 'application/json; charset=utf-8' }),
    );
    expect(response.statusCode).toBe(200);
  });

  it('本文が 8 KiB を超えたら 413', async () => {
    const harness = createHarness();
    const big = JSON.stringify({ questionnaireVersion: 'onboarding-v1', answers: [], pad: 'x'.repeat(9000) });
    const response = await harness.handler(seedEvent(big));
    expect(response.statusCode).toBe(413);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(harness.bedrock.calls).toHaveLength(0);
  });

  it('8193 バイトの本文は JSON 不正でも 413 を優先する', async () => {
    const harness = createHarness();
    const body = 'a'.repeat(8193);
    const response = await harness.handler(seedEvent(body));
    expect(response.statusCode).toBe(413);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(harness.bedrock.calls).toHaveLength(0);
  });

  it('base64 本文でも 8 KiB 超を 413 にする', async () => {
    const harness = createHarness();
    const big = JSON.stringify({ questionnaireVersion: 'onboarding-v1', answers: [], pad: 'x'.repeat(9000) });
    const response = await harness.handler(seedEventBase64(big));
    expect(response.statusCode).toBe(413);
  });

  it('JSON として解釈できなければ 400 INVALID_JSON', async () => {
    const harness = createHarness();
    const response = await harness.handler(seedEvent('{"questionnaireVersion":'));
    expect(response.statusCode).toBe(400);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('INVALID_JSON');
    expect(harness.bedrock.calls).toHaveLength(0);
  });

  const invalidOutputs: Array<{ name: string; text: string }> = [
    { name: '未定義の星ID', text: seedText([{ themeId: 'zzz', searchQuery: 'x' }, ...SEED_THEMES.slice(1)]) },
    { name: '重複した星ID', text: seedText([SEED_THEMES[0], SEED_THEMES[0], SEED_THEMES[1]]) },
    { name: '中ジャンルのID', text: seedText([{ themeId: 'tec-prog', searchQuery: 'x' }, ...SEED_THEMES.slice(1)]) },
    { name: '件数が2件', text: seedText(SEED_THEMES.slice(0, 2)) },
    { name: '件数が4件', text: seedText([...SEED_THEMES, { themeId: 'lit', searchQuery: 'x' }]) },
    { name: '空の検索語', text: seedText([{ themeId: 'tec', searchQuery: '   ' }, ...SEED_THEMES.slice(1)]) },
    {
      name: '129文字の検索語',
      text: seedText([{ themeId: 'tec', searchQuery: 'あ'.repeat(129) }, ...SEED_THEMES.slice(1)]),
    },
    { name: 'JSON でない出力', text: 'おすすめの星は tec, mon, phi です。' },
    { name: 'themes が配列でない', text: JSON.stringify({ themes: {} }) },
  ];

  for (const testCase of invalidOutputs) {
    it(`AI 出力が不正なら 502: ${testCase.name}`, async () => {
      const harness = createHarness({ bedrock: bedrockStub(() => testCase.text) });
      const response = await harness.handler(seedEvent(V1_NORMAL));
      expect(response.statusCode).toBe(502);
      expect(parseJson<ErrorBody>(response.body).error.code).toBe(
        'DISCOVERY_UPSTREAM_ERROR',
      );
    });
  }

  it('128文字ちょうどの検索語は受け付ける', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() =>
        seedText([{ themeId: 'tec', searchQuery: 'あ'.repeat(128) }, ...SEED_THEMES.slice(1)]),
      ),
    });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
  });

  it('スロットリングは 503 DISCOVERY_UNAVAILABLE', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        const error = new Error('throttled');
        error.name = 'ThrottlingException';
        throw error;
      }),
    });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(503);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('DISCOVERY_UNAVAILABLE');
  });

  it('Bedrock が停止していれば 503', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        const error = new Error('unavailable');
        error.name = 'ServiceUnavailableException';
        throw error;
      }),
    });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(503);
  });

  it('モデル側タイムアウト（ModelTimeoutException）は 504', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        const error = new Error('model timeout');
        error.name = 'ModelTimeoutException';
        throw error;
      }),
    });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(504);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('Bedrock の拒否（AccessDenied）は 502', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        const error = new Error('denied');
        error.name = 'AccessDeniedException';
        throw error;
      }),
    });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe(
      'DISCOVERY_UPSTREAM_ERROR',
    );
  });

  it('15秒上限（テストでは短縮）を超えたら 504', async () => {
    const harness = createHarness({
      bedrock: hangingBedrock(),
      limits: { totalMs: 5_000, seedBedrockMs: 20, responseReserveMs: 5 },
    });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(504);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('UPSTREAM_TIMEOUT');
  });

  it('requestId は event.requestContext.requestId を使う', async () => {
    const harness = createHarness({ bedrock: bedrockStub(() => seedText()) });
    const response = await harness.handler(seedEvent(V1_NORMAL, { requestId: 'abc-123' }));
    expect(parseJson<{ requestId: string }>(response.body).requestId).toBe('abc-123');
    expect(parseJson<ErrorBody>(
      (await harness.handler(seedEvent({ questionnaireVersion: 'x', answers: [] }, { requestId: 'err-9' }))).body,
    ).requestId).toBe('err-9');
  });
});

function recordingLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return {
    records,
    logger: {
      debug: (record) => records.push(record),
      info: (record) => records.push(record),
      warn: (record) => records.push(record),
    },
  };
}

describe('POST /v1/discovery/seed の再試行', () => {
  it('1回目が不合格でも2回目が合格すれば200を返す', async () => {
    const answers = [seedText(SEED_THEMES.slice(0, 2)), seedText()];
    const harness = createHarness({
      bedrock: bedrockStub(() => answers.shift() ?? seedText()),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL, { requestId: 'retry-1' }));

    expect(response.statusCode).toBe(200);
    expect(harness.bedrock.calls).toHaveLength(2);
    const body = parseJson<{ themes: typeof SEED_THEMES }>(response.body);
    expect(body.themes).toEqual(SEED_THEMES);
  });

  it('再試行は同じプロンプトと maxTokens を使い、upstreams に2件記録する', async () => {
    const answers = [seedText(SEED_THEMES.slice(0, 2)), seedText()];
    const { logger, records } = recordingLogger();
    const harness = createHarness({
      bedrock: bedrockStub(() => answers.shift() ?? seedText()),
      logger,
    });

    const response = await harness.handler(seedEvent(V1_NORMAL, { requestId: 'retry-2' }));
    expect(response.statusCode).toBe(200);

    const first = harness.bedrock.calls[0];
    const second = harness.bedrock.calls[1];
    expect(second?.system).toBe(first?.system);
    expect(second?.user).toBe(first?.user);
    expect(second?.maxTokens).toBe(first?.maxTokens);

    const request = records.find((record) => record.event === 'request');
    expect(request).toMatchObject({ requestId: 'retry-2', status: 200, resultCount: 3 });
    expect(request?.upstreams).toHaveLength(2);
    expect(request?.upstreams).toEqual([
      { name: 'bedrock', durationMs: expect.any(Number), outcome: 'ok' },
      { name: 'bedrock', durationMs: expect.any(Number), outcome: 'ok' },
    ]);
  });

  it('2回とも不合格なら502を返し、2回だけ呼ぶ', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText(SEED_THEMES.slice(0, 2))),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('DISCOVERY_UPSTREAM_ERROR');
    expect(harness.bedrock.calls).toHaveLength(2);
  });

  it('seed 段階の残り時間が3秒未満なら再試行せず502', async () => {
    let clock = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        clock = 13_000; // seedBedrockMs(15,000) の残りは 2,000ms
        return seedText(SEED_THEMES.slice(0, 2));
      }),
      now: () => clock,
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(502);
    expect(harness.bedrock.calls).toHaveLength(1);
  });

  it('Bedrock の例外（スロットリング）では再試行しない', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        const error = new Error('throttled');
        error.name = 'ThrottlingException';
        throw error;
      }),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(503);
    expect(harness.bedrock.calls).toHaveLength(1);
  });

  it('外側の } が欠落した出力は再試行せず200', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText().slice(0, -1)),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    expect(harness.bedrock.calls).toHaveLength(1);
    const body = parseJson<{ themes: typeof SEED_THEMES }>(response.body);
    expect(body.themes).toEqual(SEED_THEMES);
  });

  it('seed_output_rejected に reason を記録し、出力テキストと検索語を含めない', async () => {
    const invalid = JSON.stringify({
      themes: [
        { themeId: 'tec', searchQuery: 'ひみつの検索語' },
        { themeId: 'mon', searchQuery: 'ないしょの検索語' },
      ],
    });
    const { logger, records } = recordingLogger();
    const harness = createHarness({ bedrock: bedrockStub(() => invalid), logger });

    const response = await harness.handler(seedEvent(V1_NORMAL, { requestId: 'reject-1' }));
    expect(response.statusCode).toBe(502);

    const rejected = records.filter((record) => record.event === 'seed_output_rejected');
    expect(rejected).toHaveLength(2);
    expect(rejected[0]).toMatchObject({
      requestId: 'reject-1',
      reason: 'themes_count',
      attempt: 1,
    });
    expect(rejected[1]).toMatchObject({ reason: 'themes_count', attempt: 2 });

    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain('ひみつ');
    expect(serialized).not.toContain('ないしょ');
  });

  it('不正な検索語の長さは reason=query_length で記録し、検索語を漏らさない', async () => {
    const sentinel = 'LEAKSENTINEL';
    const { logger, records } = recordingLogger();
    const harness = createHarness({
      bedrock: bedrockStub(() =>
        seedText([
          { themeId: 'tec', searchQuery: `${sentinel} ${'あ'.repeat(130)}` },
          ...SEED_THEMES.slice(1),
        ]),
      ),
      logger,
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(502);
    expect(records.filter((record) => record.event === 'seed_output_rejected')).toHaveLength(2);
    expect(records.find((record) => record.event === 'seed_output_rejected')).toMatchObject({
      reason: 'query_length',
    });
    expect(JSON.stringify(records)).not.toContain(sentinel);
  });

  const retryFailures: Array<{
    name: string;
    errorName: string;
    status: number;
    code: string;
  }> = [
    { name: 'タイムアウト', errorName: 'TimeoutError', status: 504, code: 'UPSTREAM_TIMEOUT' },
    {
      name: '拒否',
      errorName: 'AccessDeniedException',
      status: 502,
      code: 'DISCOVERY_UPSTREAM_ERROR',
    },
    {
      name: 'スロットリング',
      errorName: 'ThrottlingException',
      status: 503,
      code: 'DISCOVERY_UNAVAILABLE',
    },
  ];

  for (const testCase of retryFailures) {
    it(`再試行中の Bedrock 例外は初回と同じ分類になる: ${testCase.name}`, async () => {
      const harness = createHarness({
        bedrock: bedrockStub(() => {
          if (harness.bedrock.calls.length === 1) return seedText(SEED_THEMES.slice(0, 2));
          const error = new Error(testCase.name);
          error.name = testCase.errorName;
          throw error;
        }),
      });

      const response = await harness.handler(seedEvent(V1_NORMAL));
      expect(response.statusCode).toBe(testCase.status);
      expect(parseJson<ErrorBody>(response.body).error.code).toBe(testCase.code);
      expect(harness.bedrock.calls).toHaveLength(2);
    });
  }

  it('段階の残り時間がちょうど3,000msなら再試行する', async () => {
    let clock = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        if (harness.bedrock.calls.length === 1) {
          clock = 12_000; // seedBedrockMs(15,000) - 12,000 = 3,000
          return seedText(SEED_THEMES.slice(0, 2));
        }
        return seedText();
      }),
      now: () => clock,
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    expect(harness.bedrock.calls).toHaveLength(2);
  });

  it('段階の残り時間が2,999msなら再試行しない', async () => {
    let clock = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        clock = 12_001; // 残り 2,999ms
        return seedText(SEED_THEMES.slice(0, 2));
      }),
      now: () => clock,
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(502);
    expect(harness.bedrock.calls).toHaveLength(1);
  });

  it('空の出力（ModelOutputError）は再試行し、2回目が合格すれば200', async () => {
    const { logger, records } = recordingLogger();
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        if (harness.bedrock.calls.length === 1) {
          throw new ModelOutputError('empty', 'bedrock returned no text');
        }
        return seedText();
      }),
      logger,
    });

    const response = await harness.handler(seedEvent(V1_NORMAL, { requestId: 'empty-1' }));
    expect(response.statusCode).toBe(200);
    expect(harness.bedrock.calls).toHaveLength(2);

    const rejected = records.filter((record) => record.event === 'seed_output_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      requestId: 'empty-1',
      reason: 'empty_output',
      attempt: 1,
    });

    const request = records.find((record) => record.event === 'request');
    expect(request?.upstreams).toHaveLength(2);
    expect(request?.upstreams).toEqual([
      { name: 'bedrock', durationMs: expect.any(Number), outcome: 'error' },
      { name: 'bedrock', durationMs: expect.any(Number), outcome: 'ok' },
    ]);
  });

  it('2回とも空の出力なら502', async () => {
    const { logger, records } = recordingLogger();
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        throw new ModelOutputError('empty', 'bedrock returned no text');
      }),
      logger,
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('DISCOVERY_UPSTREAM_ERROR');
    expect(harness.bedrock.calls).toHaveLength(2);

    const rejected = records.filter((record) => record.event === 'seed_output_rejected');
    expect(rejected).toHaveLength(2);
    expect(rejected.map((record) => record.reason)).toEqual(['empty_output', 'empty_output']);
  });
});

describe('POST /v1/discovery/seed の検索語の正規化', () => {
  it('空白で分割し、重複語を除いて半角スペース1つで結合する', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() =>
        seedText([
          { themeId: 'tec', searchQuery: ' 社会　人間  社会 ' },
          { themeId: 'mon', searchQuery: '哲学 思想 哲学' },
          { themeId: 'phi', searchQuery: 'デザイン\t発想\nデザイン' },
        ]),
      ),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    const body = parseJson<{ themes: Array<{ searchQuery: string }> }>(response.body);
    expect(body.themes.map((theme) => theme.searchQuery)).toEqual([
      '社会 人間',
      '哲学 思想',
      'デザイン 発想',
    ]);
  });
});

describe('seed の再試行に渡す打ち切り予算', () => {
  /** AbortSignal.timeout に渡された上限を記録し、実物の signal を返す。 */
  function captureAbortBudgets(): { budgets: number[]; restore: () => void } {
    const original = AbortSignal.timeout;
    const budgets: number[] = [];
    AbortSignal.timeout = ((ms: number) => {
      budgets.push(ms);
      return original.call(AbortSignal, ms);
    }) as typeof AbortSignal.timeout;
    return {
      budgets,
      restore: () => {
        AbortSignal.timeout = original;
      },
    };
  }

  it('2回目は段階の残り時間（3,500ms）で打ち切る', async () => {
    const answers = [seedText(SEED_THEMES.slice(0, 2)), seedText()];
    let clock = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        if (harness.bedrock.calls.length === 1) {
          // seed 段階（15,000ms）の残りを 3,500ms にする。
          clock = 11_500;
        }
        return answers.shift() ?? seedText();
      }),
      now: () => clock,
    });

    const capture = captureAbortBudgets();
    try {
      const response = await harness.handler(seedEvent(V1_NORMAL));
      expect(response.statusCode).toBe(200);
      expect(harness.bedrock.calls).toHaveLength(2);
      // 各呼び出しの直前にカウンタ（500ms）、その後 Bedrock の段階上限。
      // 1回目は seed 段階の上限、2回目は残り時間で打ち切る。
      expect(capture.budgets).toEqual([500, 15_000, 500, 3_500]);
    } finally {
      capture.restore();
    }
  });

  it('2回目は全体の残り時間が短ければそちらを使う', async () => {
    const answers = [seedText(SEED_THEMES.slice(0, 2)), seedText()];
    let clock = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => {
        if (harness.bedrock.calls.length === 1) {
          clock = 11_500;
        }
        return answers.shift() ?? seedText();
      }),
      limits: { totalMs: 15_000, seedBedrockMs: 15_000, responseReserveMs: 1_000 },
      now: () => clock,
    });

    const capture = captureAbortBudgets();
    try {
      const response = await harness.handler(seedEvent(V1_NORMAL));
      expect(response.statusCode).toBe(200);
      expect(harness.bedrock.calls).toHaveLength(2);
      // 段階の残り3,500msより、全体の残り3,500ms - 余裕1,000ms = 2,500ms が短い。
      expect(capture.budgets).toEqual([500, 14_000, 500, 2_500]);
    } finally {
      capture.restore();
    }
  });

  it('2回目は1回目と別の AbortSignal を受け取る', async () => {
    const answers = [seedText(SEED_THEMES.slice(0, 2)), seedText()];
    const harness = createHarness({
      bedrock: bedrockStub(() => answers.shift() ?? seedText()),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    const first = harness.bedrock.calls[0]?.abortSignal;
    const second = harness.bedrock.calls[1]?.abortSignal;
    expect(first).toBeInstanceOf(AbortSignal);
    expect(second).toBeInstanceOf(AbortSignal);
    expect(second).not.toBe(first);
  });
});

describe('Bedrock ゲートウェイと seed の接続', () => {
  function gatewayWithResponses(
    responses: Array<Array<{ text?: string } | { other?: string }>>,
  ): { gateway: BedrockGateway; sendCount: () => number } {
    let sends = 0;
    const config = { ...loadConfig({}), bedrockModelId: 'test-model' };
    const gateway = createBedrockGateway({
      config,
      client: {
        send: async () => {
          const content = responses.shift() ?? [];
          sends += 1;
          return { output: { message: { content } } };
        },
      } as unknown as Parameters<typeof createBedrockGateway>[0]['client'],
    });
    return { gateway, sendCount: () => sends };
  }

  it('空の content は ModelOutputError になり、seed で再試行される', async () => {
    const { gateway, sendCount } = gatewayWithResponses([[], [{ text: seedText() }]]);
    const { logger, records } = recordingLogger();
    const harness = createHarness({ bedrock: gateway, logger });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    expect(sendCount()).toBe(2);

    const rejected = records.filter((record) => record.event === 'seed_output_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: 'empty_output', attempt: 1 });
  });

  it('空白だけの text は ModelOutputError になり、seed で再試行される', async () => {
    const { gateway, sendCount } = gatewayWithResponses([
      [{ text: '   \n\t ' }],
      [{ text: seedText() }],
    ]);
    const { logger, records } = recordingLogger();
    const harness = createHarness({ bedrock: gateway, logger });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    expect(sendCount()).toBe(2);

    const rejected = records.filter((record) => record.event === 'seed_output_rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: 'empty_output', attempt: 1 });
  });

  it('通常の text は1回で成功する', async () => {
    const { gateway, sendCount } = gatewayWithResponses([[{ text: seedText() }]]);
    const harness = createHarness({ bedrock: gateway });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    expect(sendCount()).toBe(1);
    expect(parseJson<{ themes: typeof SEED_THEMES }>(response.body).themes).toEqual(SEED_THEMES);
  });

  it('2回とも空なら502になる', async () => {
    const { gateway, sendCount } = gatewayWithResponses([[], []]);
    const harness = createHarness({ bedrock: gateway });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('DISCOVERY_UPSTREAM_ERROR');
    expect(sendCount()).toBe(2);
  });
});

describe('POST /v1/discovery/seed の配列要素間の余分な " の補完', () => {
  const NOVA_STRAY_QUOTE =
    '{"themes":[{"themeId":"sci","searchQuery":"宇宙 謎"}," {"themeId":"art","searchQuery":"音楽 情動"}," {"themeId":"phi","searchQuery":"思考 知識"}]}';

  it('実出力を補完し、再試行なしで200を返す', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => NOVA_STRAY_QUOTE),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL, { requestId: 'stray-quote-1' }));
    expect(response.statusCode).toBe(200);
    expect(harness.bedrock.calls).toHaveLength(1);

    const body = parseJson<{ themes: typeof SEED_THEMES }>(response.body);
    expect(body.themes).toEqual([
      { themeId: 'sci', searchQuery: '宇宙 謎' },
      { themeId: 'art', searchQuery: '音楽 情動' },
      { themeId: 'phi', searchQuery: '思考 知識' },
    ]);
  });

  it('コードフェンス付きで外側の } も欠けた複合形でも200を返す', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => '```json\n' + NOVA_STRAY_QUOTE.slice(0, -1) + '\n```'),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    expect(harness.bedrock.calls).toHaveLength(1);
  });
});

describe('seed の日次外部呼び出し上限', () => {
  it('初回の直前で上限に達していたら 429 RATE_LIMITED で Bedrock を呼ばない', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText()),
      usage: usageStub(() => 'exceeded'),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(429);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('RATE_LIMITED');
    expect(harness.bedrock.calls).toHaveLength(0);
    expect(harness.usage.calls.map((call) => call.kind)).toEqual(['bedrock']);
  });

  it('カウンタが利用できなければ続行する（fail-open）', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText()),
      usage: usageStub(() => 'unavailable'),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    expect(harness.bedrock.calls).toHaveLength(1);
    expect(harness.usage.calls).toHaveLength(1);
  });

  it('再試行の直前で上限に達していたら 502 で Bedrock は1回だけ', async () => {
    let consumed = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText(SEED_THEMES.slice(0, 2))),
      usage: usageStub(() => {
        consumed += 1;
        return consumed === 1 ? 'ok' : 'exceeded';
      }),
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(502);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('DISCOVERY_UPSTREAM_ERROR');
    expect(harness.bedrock.calls).toHaveLength(1);
    expect(harness.usage.calls).toHaveLength(2);
  });

  it('カウンタには 500ms と段階上限の短い方を渡す', async () => {
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText()),
      usage: usageStub(() => 'ok'),
      limits: { seedBedrockMs: 200, totalMs: 25_000, responseReserveMs: 1_000 },
    });

    const original = AbortSignal.timeout;
    const budgets: number[] = [];
    AbortSignal.timeout = ((ms: number) => {
      budgets.push(ms);
      return original.call(AbortSignal, ms);
    }) as typeof AbortSignal.timeout;
    try {
      const response = await harness.handler(seedEvent(V1_NORMAL));
      expect(response.statusCode).toBe(200);
    } finally {
      AbortSignal.timeout = original;
    }

    // 1回目がカウンタ（500ms と段階上限200msの短い方）、2回目が Bedrock。
    expect(budgets).toEqual([200, 200]);
  });
});

describe('seed の段階予算とカウンタ待ち', () => {
  function captureTimeouts(): { budgets: number[]; restore: () => void } {
    const original = AbortSignal.timeout;
    const budgets: number[] = [];
    AbortSignal.timeout = ((ms: number) => {
      budgets.push(ms);
      return original.call(AbortSignal, ms);
    }) as typeof AbortSignal.timeout;
    return {
      budgets,
      restore: () => {
        AbortSignal.timeout = original;
      },
    };
  }

  it('初回はカウンタ待ちを差し引いた段階残量を Bedrock に渡す', async () => {
    let clock = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText()),
      usage: usageStub(() => {
        clock += 400;
        return 'ok';
      }),
      now: () => clock,
    });

    const capture = captureTimeouts();
    try {
      const response = await harness.handler(seedEvent(V1_NORMAL));
      expect(response.statusCode).toBe(200);
    } finally {
      capture.restore();
    }

    // カウンタは 500ms 上限、Bedrock は 15,000ms - 400ms。
    expect(capture.budgets).toEqual([500, 14_600]);
  });

  it('再試行もカウンタ待ちを差し引いた段階残量を Bedrock に渡す', async () => {
    const answers = [seedText(SEED_THEMES.slice(0, 2)), seedText()];
    let clock = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => answers.shift() ?? seedText()),
      usage: usageStub(() => {
        clock += 400;
        return 'ok';
      }),
      now: () => clock,
    });

    const capture = captureTimeouts();
    try {
      const response = await harness.handler(seedEvent(V1_NORMAL));
      expect(response.statusCode).toBe(200);
      expect(harness.bedrock.calls).toHaveLength(2);
    } finally {
      capture.restore();
    }

    // 初回 400ms、再試行でもう 400ms 進み、段階の残りは 14,200ms。
    expect(capture.budgets).toEqual([500, 14_600, 500, 14_200]);
  });

  it('カウンタ待ちで全体期限に達したら Bedrock を呼ばず 504', async () => {
    let clock = 0;
    const harness = createHarness({
      bedrock: bedrockStub(() => seedText()),
      usage: usageStub(() => {
        clock = 1_000;
        return 'ok';
      }),
      limits: { totalMs: 1_000, seedBedrockMs: 15_000, responseReserveMs: 5 },
      now: () => clock,
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(504);
    expect(parseJson<ErrorBody>(response.body).error.code).toBe('UPSTREAM_TIMEOUT');
    expect(harness.bedrock.calls).toHaveLength(0);
  });
});

describe('seed の tool use', () => {
  it('submit_themes ツールとスキーマを送り、プロンプトから JSON 出力の指示を外す', async () => {
    const harness = createHarness({ bedrock: bedrockStub(() => seedText()) });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);

    const call = harness.bedrock.jsonCalls[0];
    expect(call?.tool.name).toBe('submit_themes');

    const schema = call?.tool.inputSchema as {
      required?: string[];
      properties?: {
        themes?: {
          minItems?: number;
          maxItems?: number;
          items?: { required?: string[]; properties?: { themeId?: { enum?: string[] } } };
        };
      };
    };
    expect(schema.required).toEqual(['themes']);
    expect(schema.properties?.themes?.minItems).toBe(3);
    expect(schema.properties?.themes?.maxItems).toBe(3);
    expect(schema.properties?.themes?.items?.required).toEqual(['themeId', 'searchQuery']);
    expect(schema.properties?.themes?.items?.properties?.themeId?.enum).toHaveLength(9);

    expect(call?.system).toContain('submit_themes ツールで提出');
    expect(call?.system).not.toContain('コードフェンス');
  });

  it('スキーマ違反のオブジェクトは不合格になり再試行する', async () => {
    let calls = 0;
    const harness = createHarness({
      bedrock: {
        async converseText() {
          throw new Error('converseText must not be called');
        },
        async converseJson() {
          calls += 1;
          // 1回目は4件（スキーマ違反）、2回目は正しい3件。
          return calls === 1
            ? {
                themes: [
                  ...SEED_THEMES,
                  { themeId: 'lit', searchQuery: '小説 入門' },
                ],
              }
            : { themes: SEED_THEMES };
        },
      },
    });

    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);
    expect(calls).toBe(2);
  });
});

describe('seed の検索語プロンプト', () => {
  it('回答全体から星を選び、検索語を具体的な主題名にする制約を含める', async () => {
    const harness = createHarness({ bedrock: bedrockStub(() => seedText()) });
    const response = await harness.handler(seedEvent(V1_NORMAL));
    expect(response.statusCode).toBe(200);

    const system = harness.bedrock.jsonCalls[0]?.system ?? '';
    // 回答全体の具体的な好奇心を、抽象的な読書体験で上書きしない。
    expect(system).toContain('回答全体から');
    expect(system).toContain('具体的な好奇心');
    expect(system).toContain('抽象的な読書体験だけを表す星でそれを上書きしない');
    // 星と検索語の役割を分け、実在書の想起をさせない。
    expect(system).toContain('星は、回答から読み取れる関心の方向');
    expect(system).toContain('その星の下で書店や図書館の棚を探すときの手がかり');
    expect(system).toContain('特定の実在する本を指定するものではありません');
    expect(system).toContain('書名や著者名を考え出さない');
    // 検索語は Google Books で見つかりやすい具体的な主題名に寄せる。
    expect(system).toContain('Google Books の書名や紹介文に現れそうな具体的な主題名');
    expect(system).toContain('「言語の謎」「未知の世界」のような広い表現だけで終わらず');
    expect(system).toContain('言語学');
    expect(system).toContain('音楽心理学');
    expect(system).toContain('手芸');
    expect(system).toContain('語数も品詞も固定しない');
    expect(system).toContain('同じ意味の語を重ねたりしない');
    // 旧来の語数・品詞の一律指定は残っていない。
    expect(system).not.toContain('2〜4個');
    expect(system).not.toContain('名詞だけにする');
  });
});
