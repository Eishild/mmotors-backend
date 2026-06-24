import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Client Supabase serveur (admin).
 *
 * On utilise la clé `service_role` : elle court-circuite les Row Level Security
 * policies et permet d'écrire/lire dans des buckets privés. Elle ne doit JAMAIS
 * être envoyée au navigateur — ce client reste exclusivement côté backend.
 *
 * `supabase-js` a besoin de l'URL du projet (https://<ref>.supabase.co), pas de
 * la chaîne de connexion PostgreSQL (DATABASE_URL) : celle-ci sert uniquement à
 * Prisma. On expose donc une variable dédiée SUPABASE_URL.
 *
 * `persistSession`/`autoRefreshToken` à false : pas de session utilisateur à
 * gérer côté serveur, on s'authentifie uniquement via la clé service_role.
 */
export const supabase: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
