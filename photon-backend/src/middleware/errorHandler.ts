import type { ErrorRequestHandler } from "express";
import { env } from "../config/env.js";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({
    error:
      env.NODE_ENV === "production"
        ? "Internal server error"
        : (err as Error).message,
  });
};
