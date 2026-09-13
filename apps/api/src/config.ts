import { z } from "zod";

const boolValue = z
  .string()
  .optional()
  .transform((value) => value === undefined ? undefined : value === "1" || value.toLowerCase() === "true");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_MODE: z.enum(["demo", "bms"]).default("demo"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8788),
  DATABASE_URL: z.string().optional(),
  BMS_PASTE_URL: z.string().url().default("https://hosxp.net/phapi/PasteJSON"),
  BMS_ALLOWED_HOSTS: z.string().default("hosxp.net"),
  BMS_APP_IDENTIFIER: z.string().default("IPD-Summary-Overview"),
  BMS_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(20000),
  BMS_MARKETPLACE_TOKEN: z.string().optional(),
  SESSION_SECRET: z.string().default("development-only-session-secret-change-me"),
  CASE_REF_SECRET: z.string().default("development-only-case-ref-secret-change-me"),
  DATA_ENCRYPTION_KEY: z.string().optional(),
  AI_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("clinical-assistant"),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
  DEMO_AI: boolValue,
  COOKIE_SECURE: boolValue,
  MAX_MD_BYTES: z.coerce.number().int().min(1024).max(5_000_000).default(512_000),
  CORS_ORIGINS: z.string().default("http://127.0.0.1:5173,http://localhost:5173"),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  appMode: "demo" | "bms";
  host: string;
  port: number;
  databaseUrl?: string;
  bmsPasteUrl: string;
  bmsAllowedHosts: string[];
  bmsAppIdentifier: string;
  bmsRequestTimeoutMs: number;
  bmsMarketplaceToken?: string;
  sessionSecret: string;
  caseRefSecret: string;
  dataEncryptionKey: string;
  aiBaseUrl?: string;
  aiApiKey?: string;
  aiModel: string;
  aiTimeoutMs: number;
  demoAi: boolean;
  cookieSecure: boolean;
  maxMdBytes: number;
  corsOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.parse(env);
  if (parsed.NODE_ENV === "production" && parsed.SESSION_SECRET.includes("change-me")) {
    throw new Error("SESSION_SECRET must be configured in production");
  }
  if (parsed.NODE_ENV === "production" && parsed.CASE_REF_SECRET.includes("change-me")) {
    throw new Error("CASE_REF_SECRET must be configured in production");
  }
  if (parsed.NODE_ENV === "production" && !parsed.DATA_ENCRYPTION_KEY) {
    throw new Error("DATA_ENCRYPTION_KEY must be configured in production");
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    appMode: parsed.APP_MODE,
    host: parsed.HOST,
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    bmsPasteUrl: parsed.BMS_PASTE_URL,
    bmsAllowedHosts: parsed.BMS_ALLOWED_HOSTS.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
    bmsAppIdentifier: parsed.BMS_APP_IDENTIFIER,
    bmsRequestTimeoutMs: parsed.BMS_REQUEST_TIMEOUT_MS,
    bmsMarketplaceToken: parsed.BMS_MARKETPLACE_TOKEN,
    sessionSecret: parsed.SESSION_SECRET,
    caseRefSecret: parsed.CASE_REF_SECRET,
    dataEncryptionKey: parsed.DATA_ENCRYPTION_KEY ?? parsed.CASE_REF_SECRET,
    aiBaseUrl: parsed.AI_BASE_URL,
    aiApiKey: parsed.AI_API_KEY,
    aiModel: parsed.AI_MODEL,
    aiTimeoutMs: parsed.AI_TIMEOUT_MS,
    demoAi: parsed.DEMO_AI ?? false,
    cookieSecure: parsed.COOKIE_SECURE ?? parsed.NODE_ENV === "production",
    maxMdBytes: parsed.MAX_MD_BYTES,
    corsOrigins: parsed.CORS_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean),
  };
}
