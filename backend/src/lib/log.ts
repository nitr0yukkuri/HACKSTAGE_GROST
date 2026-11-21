/**
 * 構造化ログ（JSON 1 行）。
 *
 * 記録してよいもの: requestId・route・status・durationMs・件数・errorCode・
 * 外部呼び出しの種別と所要時間。
 * 記録してはいけないもの: 回答内容・X-Discovery-Context・API キー・
 * プロンプト全文・AI 出力全文。
 */

export type LogLevel = 'debug' | 'info' | 'silent';

export interface LogRecord {
  event: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(record: LogRecord): void;
  info(record: LogRecord): void;
  warn(record: LogRecord): void;
}

const ORDER: Record<'debug' | 'info' | 'warn', number> = {
  debug: 10,
  info: 20,
  warn: 30,
};

export type LogSink = (line: string) => void;

const stdoutSink: LogSink = (line) => {
  process.stdout.write(line + '\n');
};

export function createLogger(level: LogLevel = 'info', sink: LogSink = stdoutSink): Logger {
  const threshold = level === 'silent' ? Number.POSITIVE_INFINITY : ORDER[level];

  const emit = (recordLevel: 'debug' | 'info' | 'warn', record: LogRecord): void => {
    if (ORDER[recordLevel] < threshold) return;
    try {
      sink(JSON.stringify({ level: recordLevel, time: new Date().toISOString(), ...record }));
    } catch {
      // ログ出力の失敗でリクエストを失敗させない（循環参照など）。
    }
  };

  return {
    debug: (record) => emit('debug', record),
    info: (record) => emit('info', record),
    warn: (record) => emit('warn', record),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
};
