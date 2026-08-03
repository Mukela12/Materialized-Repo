import { QueryClient, QueryFunction } from "@tanstack/react-query";

/**
 * Error thrown for a non-2xx response, carrying the server's own error code.
 *
 * `message` keeps its original `"<status>: <body>"` shape so existing handlers
 * that display it are unaffected. What is new is `status` and `code`, so a
 * caller can branch on WHICH error occurred instead of showing one generic
 * message for every failure.
 *
 * This was not academic: the upload modal reported a trial-limit 403 as
 * "Detection failed — could not start AI scan", pointing at the wrong subsystem
 * entirely, and the subscription page's TRIAL_NOT_ELIGIBLE branch could never
 * fire because the code was buried in a string.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;

    // Servers here return { error: "CODE" } or { error: "human sentence" }.
    // Only treat it as a code when it looks like one, so a prose message is
    // never mistaken for something callers can branch on.
    let code: string | undefined;
    try {
      const body = JSON.parse(text);
      const looksLikeCode = (v: unknown): v is string =>
        typeof v === "string" && /^[A-Z][A-Z0-9_]{2,}$/.test(v);
      // Check both fields independently: `error` may hold prose while `code`
      // holds the machine value, so a prose `error` must not shadow it.
      if (looksLikeCode(body?.error)) code = body.error;
      else if (looksLikeCode(body?.code)) code = body.code;
    } catch {
      /* not JSON — leave code undefined */
    }

    throw new ApiError(`${res.status}: ${text}`, res.status, code);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
