// Browser helpers for the JSON API. Errors keep the HTTP status so callers can
// tell a rejected request (4xx, safe to edit and resend) from an unknown outcome.
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function post(path: string, input: unknown) {
  const response = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ApiError(result.error ?? 'The request could not be completed.', response.status);
  return result;
}
