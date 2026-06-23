// Chargé via `setupFiles` AVANT l'import des modules de test.
// Garantit que src/config/env.ts (qui lit process.env à l'import) voit la config de test.
import { config } from 'dotenv';

process.env.NODE_ENV = 'test';

// override: true → .env.test prime sur un éventuel .env déjà chargé dans le shell.
config({ path: '.env.test', override: true });
