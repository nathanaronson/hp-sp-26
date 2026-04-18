import { request } from "undici";
import { config } from "./config.js";
import { isMockMode, mockResponse } from "./mock.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiOptions = {
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
};

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, auth = true } = opts;

  if (isMockMode()) {
    const mocked = mockResponse(path, method);
    if (mocked !== undefined) return mocked as T;
    throw new ApiError(404, "mock_miss", `No mock for ${method} ${path}`);
  }

  const apiUrl = config.get("apiUrl");
  const token = config.get("token");

  const finalHeaders: Record<string, string> = {
    accept: "application/json",
    ...headers,
  };
  if (auth && token) finalHeaders.authorization = `Bearer ${token}`;
  if (body !== undefined && !finalHeaders["content-type"]) {
    finalHeaders["content-type"] = "application/json";
  }

  const res = await request(`${apiUrl}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.body.text();
  const parsed = text ? safeJson(text) : undefined;

  if (res.statusCode >= 400) {
    const code = (parsed as { code?: string } | undefined)?.code ?? "http_error";
    const message =
      (parsed as { message?: string } | undefined)?.message ??
      `Request failed with status ${res.statusCode}`;
    throw new ApiError(res.statusCode, code, message);
  }

  return parsed as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
