export const BACKEND_RETRY_BASE_DELAY_MS = 1000;
export const BACKEND_RETRY_MAX_DELAY_MS = 15000;

export function getBackendRetryDelay(attempt) {
  return Math.min(
    BACKEND_RETRY_BASE_DELAY_MS * (2 ** attempt),
    BACKEND_RETRY_MAX_DELAY_MS
  );
}

export function isRetryableBackendError(error) {
  const status = error?.response?.status;
  return error?.message === "Network Error" ||
    error?.message === "Request failed with status code 0" ||
    ["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"].includes(error?.code) ||
    status === 429 ||
    status >= 500;
}
