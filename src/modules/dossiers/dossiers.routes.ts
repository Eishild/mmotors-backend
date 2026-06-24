import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { upload } from '../../middlewares/upload';
import {
  addDossierOptionsSchema,
  createDossierSchema,
  updateDossierStatusSchema,
} from './dossiers.schema';
import * as dossiersController from './dossiers.controller';

const router = Router();

// ─── Suivi client (US-007) ─────────────────────────────────────────────────────
// "/me" : le client connecté ne voit que ses propres dossiers (filtre clientId).
// Déclaré avant les routes paramétrées pour éviter toute ambiguïté de matching.
router.get('/me', authenticate, dossiersController.getMyDossiers);

// ─── Back-office : liste à instruire (US-010) ──────────────────────────────────
router.get(
  '/',
  authenticate,
  authorize(Role.GESTIONNAIRE, Role.ADMIN),
  dossiersController.listDossiers,
);

// ─── Back-office : changement de statut (US-011) ───────────────────────────────
// Valider / refuser (motif obligatoire) / demander un complément.
router.patch(
  '/:id/status',
  authenticate,
  authorize(Role.GESTIONNAIRE, Role.ADMIN),
  validate(updateDossierStatusSchema),
  dossiersController.updateDossierStatus,
);

// ─── Dépôt d'un dossier (US-005 / US-006) ──────────────────────────────────────
// Réservé au CLIENT : il dépose un dossier pour lui-même (clientId = req.user).
// Le back-office instruit les dossiers mais ne les crée pas via cet endpoint.
router.post(
  '/',
  authenticate,
  authorize(Role.CLIENT),
  validate(createDossierSchema),
  dossiersController.createDossier,
);

// ─── Documents d'un dossier (US-005) ───────────────────────────────────────────
// Accès : CLIENT propriétaire OU GESTIONNAIRE/ADMIN. Le contrôle fin (ownership)
// est fait dans le service car il dépend de la donnée ; ici on exige seulement
// une authentification. upload.single('document') parse le multipart et expose
// req.file (limite 10 Mo + filtre MIME appliqués par le middleware multer).
router.post(
  '/:id/documents',
  authenticate,
  upload.single('document'),
  dossiersController.uploadDossierDocument,
);

// ─── Options de location d'un dossier (US-006) ─────────────────────────────────
// Réservé au CLIENT propriétaire : le contrôle d'appartenance (403 si dossier
// d'un autre client) et la règle "dossier LOCATION non finalisé" sont dans le
// service. Options uniquement sur un dossier de type LOCATION.
router.post(
  '/:id/options',
  authenticate,
  authorize(Role.CLIENT),
  validate(addDossierOptionsSchema),
  dossiersController.addDossierOptions,
);

export default router;
