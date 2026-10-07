/**
 * 本侧写库重试
 * 纯前端应用：没有对端写，写库失败后只重试本侧这一批——
 * 以提交时的同一批记录为限重试，不扩成全表重写，也不重拉其它来源的数据。
 */

export const LOCAL_WRITE_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 120;

export interface LocalWriteOptions {
  /** 最大尝试次数（含首次），默认 3 */
  maxAttempts?: number;
  /** 重试前退避钩子，默认按次数指数等待，测试可注入空函数跳过等待 */
  beforeRetry?: (attempt: number, error: unknown) => Promise<void> | void;
}

function defaultBackoff(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
  });
}

/**
 * 提交本侧一批记录；失败后仅按原样重试这一批（最多 maxAttempts 次）。
 * attempt 闭包固定为首次提交的批次，重试不会重新拉取或扩大范围。
 */
export async function writeLocalBatch<T>(
  attempt: () => Promise<T>,
  options: LocalWriteOptions = {},
): Promise<T> {
  const { maxAttempts = LOCAL_WRITE_MAX_ATTEMPTS, beforeRetry = defaultBackoff } = options;
  let lastError: unknown;
  for (let index = 0; index < Math.max(1, maxAttempts); index += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (index < maxAttempts - 1) await beforeRetry(index + 1, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('本地写库失败');
}
