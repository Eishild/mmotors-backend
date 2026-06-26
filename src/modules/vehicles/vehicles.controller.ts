import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { AppError } from '../../middlewares/errorHandler';
import { AuthenticatedRequest } from '../../types';
import * as vehiclesService from './vehicles.service';
import {
  CreateVehicleInput,
  UpdateVehicleInput,
  listVehiclesQuerySchema,
} from './vehicles.schema';

/** Vrai si l'appelant identifié (optionalAuthenticate) est un membre du back-office. */
function isStaff(req: AuthenticatedRequest): boolean {
  return req.user?.role === Role.GESTIONNAIRE || req.user?.role === Role.ADMIN;
}

export async function listVehicles(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // On parse la query string ici plutôt que dans un middleware : la query
    // nécessite coercition (string -> number) et valeurs par défaut, et le
    // résultat est ainsi entièrement typé (ListVehiclesQuery) sans `any`.
    // Un échec lève un ZodError, capté par le errorHandler central (-> 400).
    const query = listVehiclesQuerySchema.parse(req.query);

    // Mode back-office : réservé au staff. Un visiteur (ou un CLIENT) qui tente
    // `?scope=admin` reçoit 403 — le filtre public n'est jamais contournable.
    const wantsAdmin = query.scope === 'admin';
    if (wantsAdmin && !isStaff(req)) {
      throw new AppError(403, 'Accès réservé au back-office');
    }

    const result = await vehiclesService.listVehicles(query, wantsAdmin);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getVehicleById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Un staff peut consulter un véhicule retiré (available=false) pour l'éditer ;
    // le public reste sur un 404 (cf. service).
    const vehicle = await vehiclesService.getVehicleById(req.params.id, isStaff(req));
    res.status(200).json({ data: vehicle });
  } catch (error) {
    next(error);
  }
}

// ─── Back-office (GESTIONNAIRE / ADMIN) ────────────────────────────────────────

export async function createVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // req.body a déjà été validé/typé par le middleware validate(createVehicleSchema).
    const vehicle = await vehiclesService.createVehicle(req.body as CreateVehicleInput);
    res.status(201).json({ data: vehicle });
  } catch (error) {
    next(error);
  }
}

export async function updateVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vehicle = await vehiclesService.updateVehicle(req.params.id, req.body as UpdateVehicleInput);
    res.status(200).json({ data: vehicle });
  } catch (error) {
    next(error);
  }
}

export async function deleteVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Soft delete : 200 + ressource mise à jour plutôt que 204, pour exposer le
    // nouvel état available=false au client back-office.
    const vehicle = await vehiclesService.softDeleteVehicle(req.params.id);
    res.status(200).json({ data: vehicle, message: 'Véhicule retiré du catalogue' });
  } catch (error) {
    next(error);
  }
}

export async function toggleVehiclePurchaseType(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const vehicle = await vehiclesService.toggleVehiclePurchaseType(req.params.id);
    res.status(200).json({ data: vehicle });
  } catch (error) {
    next(error);
  }
}
