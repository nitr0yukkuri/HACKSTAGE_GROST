import { describe, expect, it } from 'vitest';

import {
  API_KEY_CACHE_TTL_MS,
  createGoogleBooksApiKeyProvider,
  loadConfig,
  type SsmRequest,
  type SsmSend,
} from '../src/lib/config.js';
import { silentLogger } from '../src/lib/log.js';

function makeProvider(
  send: SsmSend,
  env: NodeJS.ProcessEnv = {},
  now: () => number = Date.now,
) {
  const config = {
    ...loadConfig(env),
    googleBooksApiKeyParam: '/hoshirube/google-books-api-key',
  };
  return createGoogleBooksApiKeyProvider(config, silentLogger, send, now);
}

describe('loadConfig', () => {
  it('AWS_REGION を SSM 用に優先し、Bedrock は BEDROCK_REGION を使う', () => {
    const config = loadConfig({ AWS_REGION: 'us-east-1', BEDROCK_REGION: 'ap-northeast-1' });
    expect(config.awsRegion).toBe('us-east-1');
    expect(config.bedrockRegion).toBe('ap-northeast-1');
  });

  it('AWS_REGION が無ければ BEDROCK_REGION を SSM にも使う', () => {
    const config = loadConfig({ BEDROCK_REGION: 'ap-northeast-1' });
    expect(config.awsRegion).toBe('ap-northeast-1');
  });

  it('どちらも無ければ東京を既定にする', () => {
    const config = loadConfig({});
    expect(config.bedrockRegion).toBe('ap-northeast-1');
    expect(config.awsRegion).toBe('ap-northeast-1');
  });
});

describe('createGoogleBooksApiKeyProvider', () => {
  it('成功した値をキャッシュし、2回目は SSM を呼ばない', async () => {
    const requests: SsmRequest[] = [];
    const provider = makeProvider(async (request) => {
      requests.push(request);
      return { Parameter: { Value: '  KEY-1  ' } };
    });

    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBe('KEY-1');
    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBe('KEY-1');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      parameterName: '/hoshirube/google-books-api-key',
      region: 'ap-northeast-1',
    });
  });

  it('AWS_REGION を SSM のリージョンに使う', async () => {
    const requests: SsmRequest[] = [];
    const provider = makeProvider(async (request) => {
      requests.push(request);
      return { Parameter: { Value: 'KEY' } };
    }, { AWS_REGION: 'us-east-1', BEDROCK_REGION: 'ap-northeast-1' });

    await provider(AbortSignal.timeout(1_000));
    expect(requests[0]?.region).toBe('us-east-1');
  });

  it('失敗はキャッシュせず、次の呼び出しで再取得する', async () => {
    let attempts = 0;
    const provider = makeProvider(async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('temporary');
        error.name = 'InternalServerError';
        throw error;
      }
      return { Parameter: { Value: 'KEY-2' } };
    });

    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBeUndefined();
    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBe('KEY-2');
    expect(attempts).toBe(2);
  });

  it('値が空なら失敗として扱い、キャッシュしない', async () => {
    let attempts = 0;
    const provider = makeProvider(async () => {
      attempts += 1;
      return { Parameter: { Value: '   ' } };
    });

    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBeUndefined();
    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBeUndefined();
    expect(attempts).toBe(2);
  });

  it('AbortSignal を SSM 呼び出しへ渡し、打ち切り時はキーなしにする', async () => {
    let received: AbortSignal | undefined;
    const provider = makeProvider(
      (_request, signal) =>
        new Promise((_resolve, reject) => {
          received = signal;
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    );

    const controller = new AbortController();
    const pending = provider(controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(received).toBe(controller.signal);
  });

  it('キャッシュは10分で期限切れになり、期限後は SSM から再取得する', async () => {
    let clock = 0;
    let attempts = 0;
    const provider = makeProvider(
      async () => {
        attempts += 1;
        return { Parameter: { Value: `KEY-${attempts}` } };
      },
      {},
      () => clock,
    );

    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBe('KEY-1');
    clock = API_KEY_CACHE_TTL_MS - 1;
    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBe('KEY-1');
    expect(attempts).toBe(1);

    clock = API_KEY_CACHE_TTL_MS;
    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBe('KEY-2');
    expect(attempts).toBe(2);
  });

  it('invalidate() でキャッシュを捨て、次の呼び出しで SSM から再取得する', async () => {
    let attempts = 0;
    const provider = makeProvider(async () => {
      attempts += 1;
      return { Parameter: { Value: `KEY-${attempts}` } };
    });

    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBe('KEY-1');
    provider.invalidate();
    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBe('KEY-2');
    expect(attempts).toBe(2);
  });

  it('パラメータ名が未設定なら SSM を呼ばない', async () => {
    let called = false;
    const provider = createGoogleBooksApiKeyProvider(
      { ...loadConfig({}), googleBooksApiKeyParam: null },
      silentLogger,
      async () => {
        called = true;
        return { Parameter: { Value: 'KEY' } };
      },
    );

    await expect(provider(AbortSignal.timeout(1_000))).resolves.toBeUndefined();
    expect(called).toBe(false);
  });
});
