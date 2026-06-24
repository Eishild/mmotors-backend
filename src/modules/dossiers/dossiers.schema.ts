import { z } from 'zod';
import { DossierStatus, DossierType, OptionType } from '@prisma/client';

/** Valide qu'un paramètre d'URL est bien un UUID (ex. :id de dossier). */
export const dossierIdParamSchema = z.string().uuid('Identifiant de dossier invalide');

/**
 * Création d'un dossier (US-005 / US-006).
 *
 * Corps JSON. Le client connecté dépose un dossier d'ACHAT ou de LOCATION sur un
 * véhicule. Règles métier validées ici (les autres, qui nécessitent un accès
 * base — existence/cohérence du véhicule —, sont dans le service) :
 *  - `options` ne concernent QUE les dossiers de type LOCATION (CLAUDE.md) ;
 *  - on n'autorise pas de doublon d'option (le schéma Prisma impose déjà
 *    @@unique([dossierId, type])) → on déduplique via un Set.
 *
 * `clientId` n'est PAS dans le corps : il est dérivé du JWT (req.user) pour
 * qu'un client ne puisse pas déposer un dossier au nom d'autrui.
 */
export const createDossierSchema = z
  .object({
    vehicleId: z.string().uuid('Identifiant de véhicule invalide'),
    type: z.nativeEnum(DossierType),
    options: z
      .array(z.nativeEnum(OptionType))
      // Déduplication : deux fois la même option = une seule.
      .transform((opts) => [...new Set(opts)])
      .optional(),
  })
  .refine((data) => data.type === DossierType.LOCATION || !data.options?.length, {
    message: 'Les options ne sont disponibles que pour les dossiers de type LOCATION',
    path: ['options'],
  });

export type CreateDossierInput = z.infer<typeof createDossierSchema>;

/**
 * Query string de GET /dossiers (back-office, US-010).
 * `status` optionnel (filtre "à instruire" côté client), pagination par défaut.
 * Tout arrive en chaîne -> coercition des nombres comme pour les véhicules.
 */
export const listDossiersQuerySchema = z.object({
  status: z.nativeEnum(DossierStatus).optional(),
  type: z.nativeEnum(DossierType).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100, 'limit ne peut pas dépasser 100').default(20),
});

export type ListDossiersQuery = z.infer<typeof listDossiersQuerySchema>;

/**
 * Changement de statut d'un dossier (back-office, US-011).
 *
 * Règles métier validées ici :
 *  - un REFUSE doit obligatoirement comporter un motif (CLAUDE.md) ;
 *  - le motif n'a de sens que pour un refus -> rejeté sinon (évite un motif
 *    fantôme persisté sur un dossier validé).
 *
 * La validité de la TRANSITION (machine à états) dépend du statut courant en
 * base : elle est vérifiée dans le service, pas ici.
 */
export const updateDossierStatusSchema = z
  .object({
    status: z.nativeEnum(DossierStatus),
    refusalMotif: z.string().trim().min(1, 'Le motif ne peut pas être vide').optional(),
  })
  .refine((data) => data.status !== DossierStatus.REFUSE || !!data.refusalMotif, {
    message: 'Un refus doit obligatoirement comporter un motif',
    path: ['refusalMotif'],
  })
  .refine((data) => data.status === DossierStatus.REFUSE || !data.refusalMotif, {
    message: 'Le motif de refus n\'est accepté que pour un statut REFUSE',
    path: ['refusalMotif'],
  });

export type UpdateDossierStatusInput = z.infer<typeof updateDossierStatusSchema>;

/**
 * Ajout d'options à un dossier de location (US-006).
 * Au moins une option, dédupliquées (le doublon DB est de toute façon empêché
 * par @@unique([dossierId, type])). La vérification "dossier LOCATION + propriété
 * + non finalisé" relève du service (accès base).
 */
export const addDossierOptionsSchema = z.object({
  options: z
    .array(z.nativeEnum(OptionType))
    .min(1, 'Au moins une option est requise')
    .transform((opts) => [...new Set(opts)]),
});

export type AddDossierOptionsInput = z.infer<typeof addDossierOptionsSchema>;
