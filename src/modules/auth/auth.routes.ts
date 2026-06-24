import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { validate } from '../../middlewares/validate';
import { registerSchema, loginSchema } from './auth.schema';
import * as authController from './auth.controller';

const router = Router();

/**
 * Limiteur strict dédié à l'authentification (anti brute-force / credential
 * stuffing), en plus du limiteur global d'app.ts.
 *
 * - max : 10 tentatives par fenêtre en prod ; en test on retombe sur la valeur
 *   relâchée de RATE_LIMIT_MAX (10000 dans .env.test) pour ne pas bloquer la suite.
 * - skipSuccessfulRequests : seuls les échecs comptent, un utilisateur légitime
 *   qui se connecte du premier coup n'est jamais pénalisé.
 */
const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.NODE_ENV === 'test' ? env.RATE_LIMIT_MAX : 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Trop de tentatives, réessayez plus tard' },
});

router.post('/register', authLimiter, validate(registerSchema), authController.register);
router.post('/login', authLimiter, validate(loginSchema), authController.login);

export default router;
