import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { request } from "undici";
import { config } from "./config.js";
import { isMockMode, mockResponse } from "./mock.js";
import type { UploadResponse } from "./types.js";

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
    const mocked = mockResponse(path, method, body);
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

export async function uploadBundle(filePath: string): Promise<UploadResponse> {
  const size = (await stat(filePath)).size;

  if (isMockMode()) {
    const mocked = mockResponse("/api/upload", "POST", {
      filename: basename(filePath),
      size,
    });
    if (mocked !== undefined) return mocked as UploadResponse;
    throw new ApiError(404, "mock_miss", "No mock for POST /api/upload");
  }

  const apiUrl = config.get("apiUrl");
  const token = config.get("token");
  const boundary = `----dploy-${randomBytes(12).toString("hex")}`;
  const header = Buffer.from(
    [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${basename(filePath)}"`,
      "Content-Type: application/gzip",
      "",
      "",
    ].join("\r\n"),
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const file = await readFile(filePath);
  const body = Buffer.concat([header, file, footer]);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": `multipart/form-data; boundary=${boundary}`,
  };

  if (token) headers.authorization = `Bearer ${token}`;

  const res = await request(`${apiUrl}/api/upload`, {
    method: "POST",
    headers,
    body,
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

  return parsed as UploadResponse;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
