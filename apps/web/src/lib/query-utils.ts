/**
 * Resilient query utilities — timeout wrapper, logging, and retry helpers.
 * Used across all data-fetching hooks and pages.
 */

const DEFAULT_TIMEOUT_MS = 15000;

export class QueryTimeoutError extends Error {
  code = "QUERY_TIMEOUT";
  queryName: string;
  constructor(queryName: string, ms: number) {
    super(`Query "${queryName}" timed out after ${ms}ms`);
    this.queryName = queryName;
  }
}

/**
 * Wraps any promise with a timeout. If the promise doesn't resolve
 * within `ms`, rejects with a QueryTimeoutError.
 */
export function withQueryTimeout<T>(
  promise: Promise<T>,
  queryName: string,
  ms = DEFAULT_TIMEOUT_MS
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new QueryTimeoutError(queryName, ms));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Logs query performance and errors. 
 * Wrap your queryFn calls with this for debugging.
 */
export async function trackedQuery<T>(
  queryName: string,
  fn: () => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const start = performance.now();
  console.log(`[Query] ${queryName} → start`);

  try {
    const result = await withQueryTimeout(fn(), queryName, timeoutMs);
    const elapsed = Math.round(performance.now() - start);
    console.log(`[Query] ${queryName} → done (${elapsed}ms)`);
    return result;
  } catch (error) {
    const elapsed = Math.round(performance.now() - start);
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Query] ${queryName} → FAILED (${elapsed}ms): ${errMsg}`);
    throw error;
  }
}

/**
 * Formats an error into a user-friendly message.
 */
export function friendlyErrorMessage(error: unknown): string {
  if (error instanceof QueryTimeoutError) {
    return "Request timed out. Please check your connection and retry.";
  }

  const err = error as { message?: string; code?: string };
  const msg = err?.message || "";

  if (msg.toLowerCase().includes("failed to fetch") || msg.toLowerCase().includes("networkerror")) {
    return "Network error. Please check your connection and retry.";
  }

  if (msg.toLowerCase().includes("jwt expired") || msg.toLowerCase().includes("jwt")) {
    return "Your session has expired. Please sign in again.";
  }

  if (msg.includes("row-level security")) {
    return "You don't have permission to access this data.";
  }

  return "Data could not load. Please retry.";
}
