import { basename } from "node:path";
import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { request } from "undici";
import {
  adaptDeployment,
  adaptUpload,
  adaptUser,
  toBackendDeploymentCreate,
  type BackendDeployment,
  type BackendDeploymentList,
  type BackendUploadResponse,
  type BackendUser,
} from "./adapter.js";
import { config } from "./config.js";
import { isMockMode, mockResponse } from "./mock.js";
import type {
  AuthMe,
  CreateDeploymentBody,
  CreateDeploymentResponse,
  Deployment,
  UploadResponse,
} from "./types.js";

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

/**
 * Talks to the backend using the CLI's old "logical" paths
 * (/api/auth/me, /api/deployments, ...). They're translated to the real
 * `/api/v1/...` endpoints and the responses are adapted to the CLI's shapes.
 *
 * Mock mode short-circuits before any HTTP happens, returning canned data.
 */
export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { method = "GET", body, headers = {}, auth = true } = opts;

  if (isMockMode()) {
    const mocked = mockResponse(path, method, body);
    if (mocked !== undefined) return mocked as T;
    throw new ApiError(404, "mock_miss", `No mock for ${method} ${path}`);
  }

  const route = matchRoute(path, method);
  if (!route) {
    throw new ApiError(404, "unknown_route", `CLI has no mapping for ${method} ${path}`);
  }

  const apiUrl = config.get("apiUrl");
  const token = config.get("token");
  const finalHeaders: Record<string, string> = {
    accept: "application/json",
    ...headers,
  };
  if (auth && token) finalHeaders.authorization = `Bearer ${token}`;

  let payload: unknown = body;
  if (route.transformBody) payload = route.transformBody(body);
  if (payload !== undefined && !finalHeaders["content-type"]) {
    finalHeaders["content-type"] = "application/json";
  }

  const res = await request(`${apiUrl}${route.target}`, {
    method,
    headers: finalHeaders,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const text = await res.body.text();
  const parsed = text ? safeJson(text) : undefined;

  if (res.statusCode >= 400) {
    throw new ApiError(
      res.statusCode,
      "http_error",
      humanizeError(parsed) ?? `Request failed with status ${res.statusCode}`,
    );
  }

  const adapted = route.adapt ? route.adapt(parsed) : parsed;
  return adapted as T;
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

  const res = await request(`${apiUrl}/api/v1/uploads`, {
    method: "POST",
    headers,
    body,
  });

  const text = await res.body.text();
  const parsed = text ? safeJson(text) : undefined;

  if (res.statusCode >= 400) {
    throw new ApiError(
      res.statusCode,
      "http_error",
      humanizeError(parsed) ?? `Upload failed with status ${res.statusCode}`,
    );
  }

  return adaptUpload(parsed as BackendUploadResponse);
}

// ---------- Route table ----------

type Route = {
  target: string;
  transformBody?: (body: unknown) => unknown;
  adapt?: (raw: unknown) => unknown;
};

function matchRoute(path: string, method: string): Route | undefined {
  if (path === "/api/auth/me" && method === "GET") {
    return {
      target: "/api/v1/auth/me",
      adapt: (raw): AuthMe => adaptUser(raw as BackendUser),
    };
  }
  if (path === "/api/auth/logout" && method === "POST") {
    return { target: "/api/v1/auth/logout" };
  }

  if (path === "/api/deployments" && method === "GET") {
    return {
      target: "/api/v1/deployments",
      adapt: (raw): Deployment[] =>
        (raw as BackendDeploymentList).items.map(adaptDeployment),
    };
  }
  if (path === "/api/deployments" && method === "POST") {
    return {
      target: "/api/v1/deployments",
      transformBody: (body) => toBackendDeploymentCreate(body as CreateDeploymentBody),
      adapt: (raw): CreateDeploymentResponse => ({
        deploymentId: (raw as BackendDeployment).id,
      }),
    };
  }

  const idMatch = path.match(/^\/api\/deployments\/([^/]+)$/);
  if (idMatch) {
    const id = idMatch[1]!;
    if (method === "GET" || method === "DELETE") {
      return {
        target: `/api/v1/deployments/${id}`,
        adapt: (raw): Deployment => adaptDeployment(raw as BackendDeployment),
      };
    }
  }

  return undefined;
}

function humanizeError(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const detail = (parsed as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI validation errors come as a list of {loc, msg, type}.
    return detail
      .map((e: { loc?: unknown[]; msg?: string }) =>
        `${(e.loc ?? []).join(".")}: ${e.msg ?? ""}`.trim(),
      )
      .join("; ");
  }
  return undefined;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
