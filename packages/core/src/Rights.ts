// Where a user fixes a refusal: the admin pages of their instance, the
// Right each group of operations needs, as named in the integration's Roles
// Tab, and where Claude keeps the instance and the key.

import type { Operation } from './Operations.ts';

/** Where the instance and the API key are entered, in each Claude app. */
export const SETTINGS =
  'the Tipee settings in Claude (Claude Desktop: Settings → Extensions → Tipee → Configure; ' +
  'Claude Code: /plugin → Installed → tipee)';

export interface Pages {
  /** Where an admin turns the API on. */
  readonly api: string;
  /** The integrations of the instance. */
  readonly integrations: string;
  /** The Roles tab of one integration. */
  readonly roles: (integrationId: string) => string;
}

// The pages where rights are fixed, on the user's own instance.
export const pages = (instance: string): Pages => {
  const base = `https://${instance}.tipee.net`;
  return {
    api: `${base}/admin/instance/integrations/`,
    integrations: `${base}/hr-core/integrations`,
    roles: (integrationId: string) => `${base}/hr-core/profile/${integrationId}/roles`,
  };
};

// The right a group's operations usually need, as named in the Roles tab.
const RIGHTS: Record<
  string,
  { readonly module: string; readonly read?: string; readonly write?: string }
> = {
  Activity: { module: 'Activités' },
  Balances: { module: 'Calcul des soldes', read: 'Voir les soldes' },
  Directory: {
    module: 'Cœur RH',
    read: 'Voir les collaborateurs',
    write: 'Gérer les collaborateurs',
  },
  Schedule: { module: 'Planning', read: 'Voir les plannings', write: 'Planifier' },
  Timeclock: { module: 'Saisie des heures', read: 'Voir les timbrages' },
};

// Writes whose right is not the group's usual manage right.
const SPECIAL_RIGHTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^schedule_templates_/u, 'Gérer les modèles horaires'],
  [/^timechecks_delete/u, 'Supprimer un timbrage'],
  // Proposing someone else's time entries is modifying them, which this
  // Right grants along with validating them.
  [/^timechecks_(?:validate|propose)/u, "Valider l'ensemble des timbrages des personnes"],
];

export const rightFor = (target: Operation): string => {
  const rights = RIGHTS[target.group];
  if (rights === undefined) {
    return 'the right this operation needs';
  }
  const special = target.readOnly
    ? undefined
    : SPECIAL_RIGHTS.find(([pattern]) => pattern.test(target.name))?.[1];
  const right = special ?? (target.readOnly ? rights.read : rights.write);
  return right === undefined
    ? `the ${rights.module} right this operation needs`
    : `«${rights.module} → ${right}»`;
};
