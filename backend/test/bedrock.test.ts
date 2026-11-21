import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';

import { classifyBedrockError, createBedrockGateway } from '../src/lib/bedrock.js';
import { loadConfig } from '../src/lib/config.js';
import { ModelOutputError } from '../src/lib/json.js';
import type { LogRecord, Logger } from '../src/lib/log.js';

const config = { ...loadConfig({}), bedrockModelId: 'test-model' };

const TOOL = {
  name: 'submit_themes',
  description: '星の候補を提出する。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['themes'],
    properties: {
      themes: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
    },
  },
};

const BASE_PARAMS = {
  system: 'system',
  user: 'user',
  maxTokens: 16,
  abortSignal: AbortSignal.timeout(1_000),
  tool: TOOL,
};

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

function makeGateway(
  responses: unknown[],
  logger?: Logger,
): { gateway: ReturnType<typeof createBedrockGateway>; commands: Array<{ input?: unknown }> } {
  const commands: Array<{ input?: unknown }> = [];
  const client = {
    send: async (command: { input?: unknown }) => {
      commands.push(command);
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  } as unknown as Pick<BedrockRuntimeClient, 'send'>;
  return { gateway: createBedrockGateway({ config, client, logger }), commands };
}

function responseWith(content: unknown[]): unknown {
  return { output: { message: { content } }, stopReason: 'tool_use' };
}

interface ToolConfigInput {
  toolConfig?: {
    tools?: Array<{
      toolSpec?: {
        name?: string;
        description?: string;
        inputSchema?: { json?: unknown };
      };
    }>;
    toolChoice?: { tool?: { name?: string } };
  };
}

interface InferenceConfigInput {
  inferenceConfig?: { maxTokens?: number; temperature?: number };
}

describe('BedrockGateway.converseJson', () => {
  it('temperature を渡すと inferenceConfig.temperature に入る', async () => {
    const input = { themes: [{ themeId: 'tec', searchQuery: '哲学 入門' }] };
    const { gateway, commands } = makeGateway([
      responseWith([{ toolUse: { toolUseId: 't1', name: 'submit_themes', input } }]),
    ]);

    await gateway.converseJson({ ...BASE_PARAMS, temperature: 0 });

    const sent = commands[0]?.input as InferenceConfigInput;
    expect(sent.inferenceConfig).toEqual({ maxTokens: 16, temperature: 0 });
  });

  it('temperature を渡さなければ inferenceConfig に temperature キーを含めない', async () => {
    const input = { themes: [{ themeId: 'tec', searchQuery: '哲学 入門' }] };
    const { gateway, commands } = makeGateway([
      responseWith([{ toolUse: { toolUseId: 't1', name: 'submit_themes', input } }]),
    ]);

    await gateway.converseJson(BASE_PARAMS);

    const sent = commands[0]?.input as InferenceConfigInput;
    expect(sent.inferenceConfig).toEqual({ maxTokens: 16 });
    expect(Object.hasOwn(sent.inferenceConfig ?? {}, 'temperature')).toBe(false);
  });

  it('toolConfig と toolChoice を送り、toolUse.input を返す', async () => {
    const input = { themes: [{ themeId: 'tec', searchQuery: '哲学 入門' }] };
    const { gateway, commands } = makeGateway([
      responseWith([{ toolUse: { toolUseId: 't1', name: 'submit_themes', input } }]),
    ]);

    await expect(
      gateway.converseJson(BASE_PARAMS),
    ).resolves.toEqual(input);

    const sent = commands[0]?.input as ToolConfigInput;
    expect(sent.toolConfig).toEqual({
      tools: [
        {
          toolSpec: {
            name: 'submit_themes',
            description: TOOL.description,
            inputSchema: { json: TOOL.inputSchema },
          },
        },
      ],
      toolChoice: { tool: { name: 'submit_themes' } },
    });
  });

  it('名前が違う toolUse は無視し、一致する toolUse を採用する', async () => {
    const expected = { themes: [{ themeId: 'art', searchQuery: '音楽 情動' }] };
    const { gateway } = makeGateway([
      responseWith([
        { toolUse: { toolUseId: 't1', name: 'other_tool', input: { wrong: true } } },
        { toolUse: { toolUseId: 't2', name: 'submit_themes', input: expected } },
      ]),
    ]);

    await expect(gateway.converseJson(BASE_PARAMS)).resolves.toEqual(expected);
  });

  it('toolUse がなくてもテキストを JSON として読むフォールバックが効く（補完あり）', async () => {
    const { logger, records } = recordingLogger();
    const text =
      '{"themes":[{"themeId":"sci","searchQuery":"宇宙 謎"}," {"themeId":"art","searchQuery":"音楽 情動"}," {"themeId":"phi","searchQuery":"思考 知識"}]}';
    const { gateway } = makeGateway([responseWith([{ text }])], logger);

    await expect(gateway.converseJson(BASE_PARAMS)).resolves.toEqual({
      themes: [
        { themeId: 'sci', searchQuery: '宇宙 謎' },
        { themeId: 'art', searchQuery: '音楽 情動' },
        { themeId: 'phi', searchQuery: '思考 知識' },
      ],
    });
    expect(records).toContainEqual({ event: 'bedrock_tool_use_missing' });
    // 出力本文はログに出さない。
    expect(JSON.stringify(records)).not.toContain('宇宙');
  });

  it('toolUse もテキストもなければ kind=empty の ModelOutputError', async () => {
    const { gateway } = makeGateway([responseWith([])]);
    await expect(gateway.converseJson(BASE_PARAMS)).rejects.toMatchObject({
      name: 'ModelOutputError',
      kind: 'empty',
    });
  });

  it('テキストが JSON でなければ kind=not_json の ModelOutputError', async () => {
    const { gateway } = makeGateway([responseWith([{ text: 'おすすめの星は tec です。' }])]);
    await expect(gateway.converseJson(BASE_PARAMS)).rejects.toMatchObject({
      name: 'ModelOutputError',
      kind: 'not_json',
    });
  });

  it('一致する toolUse の input がオブジェクトでなく、テキストも無ければ not_json', async () => {
    const { gateway } = makeGateway([
      responseWith([{ toolUse: { toolUseId: 't1', name: 'submit_themes', input: 'x' } }]),
    ]);
    await expect(gateway.converseJson(BASE_PARAMS)).rejects.toMatchObject({
      kind: 'not_json',
    });
  });

  it('ModelOutputError は classifyBedrockError で rejected になる', async () => {
    const { gateway } = makeGateway([responseWith([])]);
    const error = await gateway.converseJson(BASE_PARAMS).catch((caught: unknown) => caught);
    expect(error instanceof ModelOutputError).toBe(true);
    expect(classifyBedrockError(error)).toBe('rejected');
  });
});
