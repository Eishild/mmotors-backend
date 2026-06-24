import { Router } from 'express';
import { Role } from '@prisma/client';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { upload } from '../../middlewares/upload';
import { createDossierSchema } from './dossiers.schema';
import * as dossiersController from './dossiers.controller';

const router = Router();

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

export default router;
