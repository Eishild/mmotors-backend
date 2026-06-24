import { z } from 'zod';
import { DossierType, OptionType } from '@prisma/client';

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
