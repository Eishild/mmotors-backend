import request from 'supertest';
import type { Application } from 'express';

/**
 * Vérifie l'anti brute-force sur /api/v1/auth/login.
 *
 * Contrainte : en environnement de test, le limiteur d'auth retombe sur
 * RATE_LIMIT_MAX (10000 dans .env.test) pour ne pas bloquer la suite d'auth.
 * Ici on veut au contraire DÉCLENCHER le 429 : on abaisse donc RATE_LIMIT_MAX
 * AVANT d'importer l'app (env.ts lit process.env à l'import), dans un fichier
 * de test isolé pour ne pas impacter les autres suites.
 *
 * NB : en test, le limiteur global (app.ts) et le limiteur d'auth partagent
 * RATE_LIMIT_MAX ; ce test garantit le comportement observable — marteler
 * /login finit par renvoyer 429 — ce qui est la protection recherchée.
 */

const MAX = 5;

// .env.test fixe RATE_LIMIT_MAX (10000) ; on le capture pour le restaurer ensuite.
const ORIGINAL_MAX = process.env.RATE_LIMIT_MAX;

let app: Application;

beforeAll(() => {
  process.env.RATE_LIMIT_MAX = String(MAX);
  jest.resetModules(); // force la relecture de src/config/env.ts avec la nouvelle valeur.
  // require (CommonJS) plutôt qu'import() dynamique : ce dernier part en ESM
  // natif sous ts-jest et échoue. resetModules garantit un module frais.
  app = (require('../src/app') as { default: Application }).default;
});

afterAll(() => {
  // --runInBand partage le process entre fichiers : on remet RATE_LIMIT_MAX à sa
  // valeur d'origine pour ne pas plomber les autres suites (ex. auth.test.ts).
  process.env.RATE_LIMIT_MAX = ORIGINAL_MAX;
  jest.resetModules();
});

describe('POST /api/v1/auth/login — rate limiting', () => {
  it('renvoie 429 après trop de tentatives de login échouées', async () => {
    const attempt = () =>
      request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'inconnu@example.com', password: 'WrongPassword1' });

    let lastStatus = 0;
    let blockedAt = -1;

    // On dépasse volontairement le seuil ; on s'arrête dès le premier 429.
    for (let i = 1; i <= MAX + 3; i++) {
      lastStatus = (await attempt()).status;
      if (lastStatus === 429) {
        blockedAt = i;
        break;
      }
      // Tant qu'on n'est pas bloqué, l'échec d'auth doit être un 401.
      expect(lastStatus).toBe(401);
    }

    expect(lastStatus).toBe(429);
    // Le blocage survient une fois le quota dépassé, pas avant.
    expect(blockedAt).toBeGreaterThan(MAX);
  }, 30000);
});
