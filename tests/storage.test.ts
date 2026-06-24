import { uploadDocument, getSignedUrl } from '../src/modules/dossiers/storage.service';
import { supabase } from '../src/config/supabase';
import { AppError } from '../src/middlewares/errorHandler';

/**
 * Tests unitaires du service Storage.
 *
 * On mocke entièrement le client supabase-js : ces tests valident NOTRE logique
 * (forme du chemin d'objet, options d'upload, durée de l'URL signée, mapping des
 * erreurs vers AppError) sans dépendre du réseau ni d'un vrai bucket Supabase.
 */

jest.mock('../src/config/supabase', () => {
  const upload = jest.fn();
  const createSignedUrl = jest.fn();
  return {
    supabase: {
      storage: {
        from: jest.fn(() => ({ upload, createSignedUrl })),
      },
    },
  };
});

const BUCKET = 'dossier-documents';
const DOSSIER_ID = '11111111-1111-1111-1111-111111111111';

// Accès typés aux mocks (from() renvoie toujours le même objet de mocks).
const fromMock = supabase.storage.from as jest.Mock;
const uploadMock = fromMock(BUCKET).upload as jest.Mock;
const createSignedUrlMock = fromMock(BUCKET).createSignedUrl as jest.Mock;

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'document',
    originalname: 'carte-identite.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: 1024,
    buffer: Buffer.from('fake-pdf-content'),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

describe('uploadDocument', () => {
  it('upload dans le bucket privé avec un chemin <dossierId>/<uuid>.<ext>', async () => {
    uploadMock.mockResolvedValueOnce({ data: { path: 'x' }, error: null });

    const file = { ...makeFile(), originalname: 'piece.PDF', mimetype: 'application/pdf' };
    const { filePath } = await uploadDocument(DOSSIER_ID, file);

    // Chemin : préfixe dossier + UUID v4 + extension en minuscule.
    expect(filePath).toMatch(
      new RegExp(`^${DOSSIER_ID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$`),
    );

    expect(supabase.storage.from).toHaveBeenCalledWith(BUCKET);
    expect(uploadMock).toHaveBeenCalledWith(filePath, file.buffer, {
      contentType: 'application/pdf',
      upsert: false,
    });
  });

  it('génère un nom unique à chaque appel (pas de collision)', async () => {
    uploadMock.mockResolvedValue({ data: { path: 'x' }, error: null });

    const file = makeFile();
    const a = await uploadDocument(DOSSIER_ID, file);
    const b = await uploadDocument(DOSSIER_ID, file);

    expect(a.filePath).not.toBe(b.filePath);
  });

  it('lève une AppError 502 si Supabase renvoie une erreur', async () => {
    uploadMock.mockResolvedValueOnce({ data: null, error: { message: 'bucket not found' } });

    const error = await uploadDocument(DOSSIER_ID, makeFile()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 502 });
  });
});

describe('getSignedUrl', () => {
  it('génère une URL signée valable 60 secondes', async () => {
    createSignedUrlMock.mockResolvedValueOnce({
      data: { signedUrl: 'https://signed.example/doc?token=abc' },
      error: null,
    });

    const url = await getSignedUrl(`${DOSSIER_ID}/file.pdf`);

    expect(url).toBe('https://signed.example/doc?token=abc');
    expect(supabase.storage.from).toHaveBeenCalledWith(BUCKET);
    expect(createSignedUrlMock).toHaveBeenCalledWith(`${DOSSIER_ID}/file.pdf`, 60);
  });

  it('lève une AppError 502 si la génération échoue', async () => {
    createSignedUrlMock.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    await expect(getSignedUrl('missing.pdf')).rejects.toBeInstanceOf(AppError);
  });

  it('lève une AppError 502 si aucune donnée n\'est renvoyée (sans erreur explicite)', async () => {
    // Cas limite : Supabase renvoie data=null ET error=null -> on protège quand même.
    createSignedUrlMock.mockResolvedValueOnce({ data: null, error: null });

    const error = await getSignedUrl('x.pdf').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 502 });
  });
});
