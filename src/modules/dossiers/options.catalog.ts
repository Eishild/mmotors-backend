import { OptionType, Prisma } from '@prisma/client';

/**
 * Catalogue des options de LOCATION (US-006).
 *
 * Les prix sont des montants mensuels en euros, exprimés en `Prisma.Decimal`
 * (jamais en Float — cf. CLAUDE.md "Decimal pour les montants"). Ils sont
 * centralisés ici : source unique de vérité pour l'affichage (cases à cocher
 * côté front) ET le calcul du total mensuel côté serveur, afin que le client ne
 * puisse pas falsifier les prix.
 */

/** Libellé lisible de chaque option (affiché dans les cases à cocher du front). */
export const OPTION_LABELS: Record<OptionType, string> = {
  [OptionType.ASSURANCE_TOUS_RISQUES]: 'Assurance tous risques',
  [OptionType.ASSISTANCE_DEPANNAGE]: 'Assistance dépannage',
  [OptionType.ENTRETIEN_SAV]: 'Entretien / SAV',
  [OptionType.CONTROLE_TECHNIQUE]: 'Contrôle technique',
};

/**
 * Prix mensuel (EUR/mois) de chaque option. Valeurs cohérentes pour une LLD :
 * l'assurance tous risques est l'option la plus chère, le contrôle technique la
 * plus modeste.
 */
export const OPTION_MONTHLY_PRICES: Record<OptionType, Prisma.Decimal> = {
  [OptionType.ASSURANCE_TOUS_RISQUES]: new Prisma.Decimal('49.90'),
  [OptionType.ENTRETIEN_SAV]: new Prisma.Decimal('29.90'),
  [OptionType.ASSISTANCE_DEPANNAGE]: new Prisma.Decimal('9.90'),
  [OptionType.CONTROLE_TECHNIQUE]: new Prisma.Decimal('5.90'),
};

/** Une option tarifée telle qu'exposée par l'API (Decimal sérialisé en string). */
export interface PricedOption {
  type: OptionType;
  label: string;
  monthlyPrice: Prisma.Decimal;
}

/**
 * Catalogue complet des options proposées, trié par prix décroissant (l'option
 * la plus valorisée en premier). Sert l'écran de dépôt : 4 cases à cocher avec
 * leur prix mensuel.
 */
export function getOptionsCatalog(): PricedOption[] {
  return (Object.keys(OPTION_MONTHLY_PRICES) as OptionType[])
    .map((type) => ({ type, label: OPTION_LABELS[type], monthlyPrice: OPTION_MONTHLY_PRICES[type] }))
    .sort((a, b) => b.monthlyPrice.comparedTo(a.monthlyPrice));
}

/** Associe à une liste de types d'options leur libellé et prix mensuel. */
export function priceOptions(types: OptionType[]): PricedOption[] {
  return types.map((type) => ({
    type,
    label: OPTION_LABELS[type],
    monthlyPrice: OPTION_MONTHLY_PRICES[type],
  }));
}

/**
 * Total mensuel des options sélectionnées. Calculé en Decimal pour éviter toute
 * imprécision flottante sur les montants. Renvoie 0.00 pour une liste vide.
 */
export function computeMonthlyOptionsTotal(types: OptionType[]): Prisma.Decimal {
  return types.reduce(
    (total, type) => total.plus(OPTION_MONTHLY_PRICES[type]),
    new Prisma.Decimal(0),
  );
}
