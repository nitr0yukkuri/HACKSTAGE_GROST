import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

import type { AppConfig } from './config.js';
import { ModelOutputError, parseModelJson } from './json.js';
import type { Logger } from './log.js';

/**
 * Bedrock Converse API の薄いラッパー。
 * 特定モデルに依存しないよう、モデルIDは設定値から渡し、出力はテキストまたは
 * tool use の input として扱う。
 */

export interface ConverseParams {
  system: string;
  user: string;
  maxTokens: number;
  abortSignal: AbortSignal;
}

/** tool use で構造化出力を受け取るときのツール定義。 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ConverseJsonParams = ConverseParams & { tool: ToolDefinition };

export interface BedrockGateway {
  /** Converse を 1 回だけ呼び、モデルのテキスト出力を返す。 */
  converseText(params: ConverseParams): Promise<string>;
  /**
   * Converse を 1 回だけ呼び、指定したツールの input（パース済みのオブジェクト）を返す。
   * tool use が返らない場合は、テキストを JSON として読むフォールバックを行う。
   */
  converseJson(params: ConverseJsonParams): Promise<unknown>;
}

export type BedrockFailure = 'timeout' | 'unavailable' | 'rejected' | 'unknown';

const TIMEOUT_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'RequestTimeout',
  'RequestTimeoutException',
  'ModelTimeoutException',
]);
const UNAVAILABLE_NAMES = new Set([
  'ThrottlingException',
  'Throttling',
  'TooManyRequestsException',
  'ServiceUnavailableException',
  'ModelNotReadyException',
  'InternalServerException',
  'InternalFailure',
  'NetworkingError',
]);
const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);
const REJECTED_NAMES = new Set([
  'AccessDeniedException',
  'UnauthorizedException',
  'ValidationException',
  'ResourceNotFoundException',
  'ModelErrorException',
  'SerializationException',
  'DeserializationException',
]);

/**
 * Bedrock 呼び出しの失敗を分類する。
 * - timeout: 打ち切り（段階上限・全体期限）とモデル側タイムアウト → 504
 * - unavailable: スロットリング・サービス停止・接続失敗 → 503（seed のみ）
 * - rejected: Bedrock がリクエストを拒否（AccessDenied・Validation など）→ 502
 * - unknown: 上記以外。呼び出し側で 503 とする
 */
export function classifyBedrockError(error: unknown): BedrockFailure {
  if (error instanceof ModelOutputError) return 'rejected';
  if (!(error instanceof Error)) return 'unknown';
  if (TIMEOUT_NAMES.has(error.name)) return 'timeout';
  if (UNAVAILABLE_NAMES.has(error.name)) return 'unavailable';
  if (REJECTED_NAMES.has(error.name)) return 'rejected';

  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && NETWORK_CODES.has(code)) return 'unavailable';

  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
    ?.httpStatusCode;
  if (typeof status === 'number') {
    if (status >= 400 && status < 500) return 'rejected';
    if (status >= 500) return 'unavailable';
  }
  return 'unknown';
}

export interface BedrockGatewayOptions {
  config: AppConfig;
  client?: Pick<BedrockRuntimeClient, 'send'>;
  /** tool use が返らずテキストへフォールバックしたときに警告するため。 */
  logger?: Logger;
}

export function createBedrockGateway(options: BedrockGatewayOptions): BedrockGateway {
  let client = options.client;
  const getClient = (): Pick<BedrockRuntimeClient, 'send'> => {
    client ??= new BedrockRuntimeClient({
      region: options.config.bedrockRegion,
      // 外部呼び出しは自動再試行しない（全体期限を守るため）。
      maxAttempts: 1,
    });
    return client;
  };

  const send = (
    params: ConverseParams,
    extra: { toolConfig?: ConverseCommand['input']['toolConfig'] },
  ) => {
    if (!options.config.bedrockModelId) {
      throw new BedrockConfigurationError('BEDROCK_MODEL_ID is not set');
    }
    const command = new ConverseCommand({
      modelId: options.config.bedrockModelId,
      system: [{ text: params.system }],
      messages: [{ role: 'user', content: [{ text: params.user }] }],
      inferenceConfig: { maxTokens: params.maxTokens },
      ...extra,
    });
    return getClient().send(command, { abortSignal: params.abortSignal });
  };

  return {
    async converseText(params: ConverseParams): Promise<string> {
      const response = await send(params, {});
      const text = textOf(response);
      if (text === '') throw new ModelOutputError('empty', 'bedrock returned no text');
      return text;
    },

    async converseJson(params: ConverseJsonParams): Promise<unknown> {
      // SDK の DocumentType は unknown 相当だが TypeScript 上は配列も含む union のため、
      // ここで境界のキャストだけ行う（入力は JSON Schema として渡す）。
      const toolConfig = {
        tools: [
          {
            toolSpec: {
              name: params.tool.name,
              description: params.tool.description,
              inputSchema: { json: params.tool.inputSchema },
            },
          },
        ],
        toolChoice: { tool: { name: params.tool.name } },
      } as unknown as ConverseCommand['input']['toolConfig'];

      const response = await send(params, { toolConfig });

      const blocks = response.output?.message?.content ?? [];
      let matchedToolUse = false;
      for (const block of blocks) {
        const toolUse = (block as { toolUse?: { name?: unknown; input?: unknown } }).toolUse;
        if (!toolUse || toolUse.name !== params.tool.name) continue;
        matchedToolUse = true;
        const input = toolUse.input;
        if (typeof input === 'object' && input !== null && !Array.isArray(input)) {
          return input;
        }
      }

      // tool use が返らない場合だけ、テキストを JSON として読むフォールバックを使う。
      const text = textOf(response);
      if (text !== '') {
        options.logger?.warn({ event: 'bedrock_tool_use_missing' });
        try {
          return parseModelJson(text);
        } catch {
          throw new ModelOutputError('not_json');
        }
      }
      if (matchedToolUse) throw new ModelOutputError('not_json');
      throw new ModelOutputError('empty');
    },
  };
}

function textOf(response: unknown): string {
  const output = (response as { output?: { message?: { content?: unknown } } }).output;
  const content = output?.message?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block !== 'object' || block === null) return '';
      const text = (block as { text?: unknown }).text;
      return typeof text === 'string' ? text : '';
    })
    .join('')
    .trim();
}

/** 設定不足（モデルID未設定など）。500 INTERNAL_ERROR として扱う。 */
export class BedrockConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BedrockConfigurationError';
  }
}
