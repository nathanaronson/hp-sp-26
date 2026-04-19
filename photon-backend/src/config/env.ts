import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  CORS_ORIGIN: z.string().default("*"),
  SPECTRUM_PROJECT_ID: z.string(),
  SPECTRUM_PROJECT_SECRET: z.string(),
});

export const env = envSchema.parse(process.env);
