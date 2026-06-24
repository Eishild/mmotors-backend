import { Router } from 'express';
import * as vehiclesController from './vehicles.controller';

const router = Router();

// Routes publiques (US-001 / US-002) : aucun auth requis.
router.get('/', vehiclesController.listVehicles);
router.get('/:id', vehiclesController.getVehicleById);

export default router;
