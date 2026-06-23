# MMoto Backend

API REST Node.js + Express + TypeScript pour la gestion de véhicules, dossiers et utilisateurs.

## Stack technique

- **Runtime**: Node.js 20+
- **Framework**: Express 4
- **Language**: TypeScript 5 (strict mode)
- **ORM**: Prisma 5
- **Base de données**: PostgreSQL
- **Auth**: JWT (access + refresh tokens)
- **Validation**: Zod
- **Tests**: Jest + Supertest
- **Logger**: Winston

## Démarrage rapide

```bash
# 1. Copier les variables d'environnement
cp .env.example .env

# 2. Installer les dépendances
npm install

# 3. Générer le client Prisma
npx prisma generate

# 4. Appliquer les migrations
npx prisma migrate dev

# 5. Lancer en développement
npm run dev
```

## Scripts

| Commande | Description |
|---|---|
| `npm run dev` | Démarrage avec hot-reload (nodemon + tsx) |
| `npm run build` | Compilation TypeScript → dist/ |
| `npm start` | Démarrage depuis dist/ (production) |
| `npm test` | Lancer les tests Jest |
| `npm run lint` | Vérification ESLint |
| `npm run format` | Formatage Prettier |

## Structure

```
src/
├── config/       # env, prisma client, constantes
├── middlewares/  # auth, errorHandler, validation, rateLimit
├── modules/      # Organisation par domaine métier
│   ├── auth/     # register, login, JWT
│   ├── vehicles/ # CRUD véhicules + vente/location
│   ├── dossiers/ # dépôt, suivi, validation
│   └── users/    # profil, espace client
├── utils/        # helpers, logger
├── types/        # types TypeScript partagés
├── app.ts        # config Express
└── server.ts     # point d'entrée
```

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| GET | `/health` | Health check |
