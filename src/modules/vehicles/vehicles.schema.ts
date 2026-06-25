import { z } from 'zod';
import { FuelType, PurchaseType, Transmission, VehicleStatus } from '@prisma/client';

// Année plausible : de 1900 à l'année prochaine (modèles à venir).
const currentYear = new Date().getFullYear();

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

    // ─── Mode back-office (GESTIONNAIRE/ADMIN, US-008) ───────────────────────
    // `scope=admin` lève le filtre public (available + DISPONIBLE) pour lister
    // l'ensemble du parc. Le contrôle de rôle est fait dans le contrôleur ; ces
    // deux filtres ne sont pris en compte qu'en mode admin (ignorés côté public).
    scope: z.enum(['public', 'admin']).optional(),
    status: z.nativeEnum(VehicleStatus).optional(),
    // Query string → on n'accepte explicitement que "true"/"false" ('' = ignoré).
    available: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
  })
  // Cohérence de la fourchette de prix.
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: 'minPrice doit être inférieur ou égal à maxPrice',
    path: ['minPrice'],
  });

export type ListVehiclesQuery = z.infer<typeof listVehiclesQuerySchema>;

/**
 * Création d'un véhicule (POST, back-office).
 * Le corps est en JSON : les nombres arrivent déjà typés, pas besoin de coerce.
 * Champs requis : brand, model, year, mileage, price, fuelType, purchaseType.
 * `available` n'est pas exposé : un véhicule créé est toujours disponible
 * (le retrait passe par le soft delete DELETE).
 */
export const createVehicleSchema = z.object({
  brand: z.string().trim().min(1, 'La marque est requise'),
  model: z.string().trim().min(1, 'Le modèle est requis'),
  year: z
    .number()
    .int('L\'année doit être un entier')
    .min(1900, 'Année invalide')
    .max(currentYear + 1, 'Année invalide'),
  mileage: z.number().int('Le kilométrage doit être un entier').nonnegative('Le kilométrage doit être positif'),
  price: z.number().positive('Le prix doit être positif'),
  fuelType: z.nativeEnum(FuelType),
  purchaseType: z.nativeEnum(PurchaseType),
  transmission: z.nativeEnum(Transmission).optional(),
  color: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  status: z.nativeEnum(VehicleStatus).optional(),
  images: z.array(z.string().url('URL d\'image invalide')).default([]),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

/**
 * Mise à jour d'un véhicule (PUT, back-office).
 * Tous les champs sont optionnels (mise à jour partielle), mais au moins un
 * doit être fourni. Pas de `.default([])` ici : sinon une requête sans `images`
 * écraserait les photos existantes par un tableau vide.
 *
 * `purchaseType` est volontairement exclu : la bascule VENTE↔LOCATION passe par
 * l'endpoint dédié PATCH /:id/status, qui vérifie l'absence de dossier en cours.
 * `available` est également exclu : il n'est piloté que par le soft delete.
 */
export const updateVehicleSchema = z
  .object({
    brand: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
    year: z
      .number()
      .int()
      .min(1900)
      .max(currentYear + 1)
      .optional(),
    mileage: z.number().int().nonnegative().optional(),
    price: z.number().positive().optional(),
    fuelType: z.nativeEnum(FuelType).optional(),
    transmission: z.nativeEnum(Transmission).optional(),
    color: z.string().trim().min(1).optional(),
    description: z.string().trim().min(1).optional(),
    status: z.nativeEnum(VehicleStatus).optional(),
    images: z.array(z.string().url('URL d\'image invalide')).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Au moins un champ doit être fourni',
  });

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
