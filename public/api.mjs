// Talks to the server. A browser that has never saved anything simply has no
// session yet; the first saved order quietly creates this browser's notebook.
export class ApiError extends Error {
  constructor(message, status = 0, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let onSignedOut = () => {};
export function whenSignedOut(handler) { onSignedOut = handler; }

export async function api(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api' + path, {
      ...options,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: {'Content-Type': 'application/json', ...options.headers}
    });
    const data = await response.json().catch(() => ({error: 'კავშირი ვერ დამყარდა. სცადე ხელახლა.'}));
    if (!response.ok) {
      if (response.status === 401 && data.code === 'signed-out') onSignedOut();
      throw new ApiError(data.error || 'მოქმედება ვერ შესრულდა.', response.status, data.code);
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError') throw new ApiError('პასუხი დაგვიანდა. შეამოწმე ინტერნეტი და სცადე ხელახლა.');
    throw new ApiError('კავშირი ვერ დამყარდა. შეამოწმე ინტერნეტი.');
  } finally {
    clearTimeout(timer);
  }
}

export const send = (path, method, body = {}) => api(path, {method, body: JSON.stringify(body)});
