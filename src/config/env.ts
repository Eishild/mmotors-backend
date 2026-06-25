import { z } from 'zod';
import { logger } from '../utils/logger';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  // URL du projet Supabase (https://<ref>.supabase.co) — requise par supabase-js.
  SUPABASE_URL: z.string().url(),
  // Clé service_role : pouvoirs admin, côté serveur uniquement, jamais exposée au client.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  // DSN Sentry : optionnel. Absent ou vide => monitoring désactivé (dégradation propre).
  // La chaîne vide (SENTRY_DSN= dans .env) est normalisée en undefined avant validation.
  SENTRY_DSN: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  logger.error('Invalid environment variables', { errors: parsed.error.flatten().fieldErrors });
  process.exit(1);
}

export const env = parsed.data;
