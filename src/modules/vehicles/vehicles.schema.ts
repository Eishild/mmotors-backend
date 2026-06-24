import { z } from 'zod';
import { FuelType, PurchaseType } from '@prisma/client';

/**
 * Validation de la query string de GET /api/v1/vehicles.
 *
 * Particularités d'une query string :
 * - tout arrive sous forme de chaîne → on utilise z.coerce pour convertir
 *   les nombres (prix, kilométrage, pagination) ;
 * - les filtres sont tous optionnels ;
 * - page/limit ont des valeurs par défaut (1 et 20).
 *
 * Note sur le vocabulaire : la consigne parlait de "motorisation" et de
 * "status (VENTE/LOCATION)". Dans le schéma Prisma ces notions correspondent
 * respectivement aux champs `fuelType` (enum FuelType) et `purchaseType`
 * (enum PurchaseType). On expose donc des paramètres alignés sur le schéma
 * pour éviter toute ambiguïté avec le vrai champ `status` (VehicleStatus).
 */
export const listVehiclesQuerySchema = z
  .object({
    // contains + insensitive est géré côté service ; ici on nettoie juste l'entrée.
    brand: z.string().trim().optional(),
    model: z.string().trim().optional(),

    // motorisation : correspondance exacte sur l'enum FuelType.
    fuelType: z.nativeEnum(FuelType).optional(),

    // VENTE / LOCATION : correspondance exacte sur l'enum PurchaseType.
    purchaseType: z.nativeEnum(PurchaseType).optional(),

    // Montants : Decimal en base, mais on valide des nombres positifs côté API.
    minPrice: z.coerce.number().positive('minPrice doit être positif').optional(),
    maxPrice: z.coerce.number().positive('maxPrice doit être positif').optional(),

    // Kilométrage : entier >= 0 (0 = véhicule neuf).
    maxMileage: z.coerce
      .number()
      .int('maxMileage doit être un entier')
      .nonnegative('maxMileage doit être positif')
      .optional(),

    // Pagination : entiers positifs, avec une limite max raisonnable pour
    // éviter qu'un client ne demande des pages gigantesques.
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100, 'limit ne peut pas dépasser 100').default(20),
  })
  // Cohérence de la fourchette de prix.
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: 'minPrice doit être inférieur ou égal à maxPrice',
    path: ['minPrice'],
  });

export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;
