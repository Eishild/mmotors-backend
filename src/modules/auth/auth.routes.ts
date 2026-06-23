import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { registerSchema, loginSchema } from './auth.schema';
import * as authController from './auth.controller';

const router = Router();

router.post('/register', validate(registerSchema), authController.register);
router.post('/login', validate(loginSchema), authController.login);

export default router;
