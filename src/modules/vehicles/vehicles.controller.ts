import { Request, Response, NextFunction } from 'express';
import * as vehiclesService from './vehicles.service';
import { listVehiclesQuerySchema } from './vehicles.schema';

export async function listVehicles(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // On parse la query string ici plutôt que dans un middleware : la query
    // nécessite coercition (string -> number) et valeurs par défaut, et le
    // résultat est ainsi entièrement typé (ListVehiclesQuery) sans `any`.
    // Un échec lève un ZodError, capté par le errorHandler central (-> 400).
    const query = listVehiclesQuerySchema.parse(req.query);
    const result = await vehiclesService.listVehicles(query);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getVehicleById(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const vehicle = await vehiclesService.getVehicleById(req.params.id);
    res.status(200).json({ data: vehicle });
  } catch (error) {
    next(error);
  }
}
