import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../../middlewares/authenticate';
import { optionalAuthenticate } from '../../middlewares/optionalAuthenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { createVehicleSchema, updateVehicleSchema } from './vehicles.schema';
import * as vehiclesController from './vehicles.controller';

const router = Router();

// ─── Routes publiques (US-001 / US-002) ────────────────────────────────────────
// `optionalAuthenticate` : public par défaut, mais identifie un staff connecté
// pour débloquer le mode back-office (listing complet, fiche d'un véhicule retiré).
router.get('/', optionalAuthenticate, vehiclesController.listVehicles);
router.get('/:id', optionalAuthenticate, vehiclesController.getVehicleById);

// ─── Routes back-office (US-008 à US-009) ──────────────────────────────────────
// Réservées aux GESTIONNAIRE / ADMIN : authenticate (JWT) puis authorize (rôle).
router.post(
  '/',
  authenticate,
  authorize(Role.GESTIONNAIRE, Role.ADMIN),
  validate(createVehicleSchema),
  vehiclesController.createVehicle,
);

router.put(
  '/:id',
  authenticate,
  authorize(Role.GESTIONNAIRE, Role.ADMIN),
  validate(updateVehicleSchema),
  vehiclesController.updateVehicle,
);

router.delete(
  '/:id',
  authenticate,
  authorize(Role.GESTIONNAIRE, Role.ADMIN),
  vehiclesController.deleteVehicle,
);

router.patch(
  '/:id/status',
  authenticate,
  authorize(Role.GESTIONNAIRE, Role.ADMIN),
  vehiclesController.toggleVehiclePurchaseType,
);

export default router;
