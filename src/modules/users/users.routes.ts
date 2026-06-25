import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import {
  changePasswordSchema,
  updateProfileSchema,
  updateRoleSchema,
} from './users.schema';
import * as usersController from './users.controller';

const router = Router();

// ─── Espace personnel (tout utilisateur authentifié) ───────────────────────────
// Déclaré AVANT les routes paramétrées /:id pour éviter que "me" ne soit capturé
// comme un identifiant.
router.get('/me', authenticate, usersController.getMe);
router.patch('/me', authenticate, validate(updateProfileSchema), usersController.updateProfile);
router.patch(
  '/me/password',
  authenticate,
  validate(changePasswordSchema),
  usersController.changePassword,
);

// ─── Administration des comptes (ADMIN uniquement) ──────────────────────────────
router.get('/', authenticate, authorize(Role.ADMIN), usersController.listUsers);
router.get('/:id', authenticate, authorize(Role.ADMIN), usersController.getUserById);
router.patch(
  '/:id/role',
  authenticate,
  authorize(Role.ADMIN),
  validate(updateRoleSchema),
  usersController.updateRole,
);
router.delete('/:id', authenticate, authorize(Role.ADMIN), usersController.deleteUser);

export default router;
