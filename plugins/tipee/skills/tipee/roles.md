# Tipee rights for the tools

What an integration can do is the sum of the rights ticked in its Roles tab,
reached from `https://<instance>.tipee.net/hr-core/integrations`. The names
below are those of that screen, in the admin panel's language; it lists only
the modules enabled on the instance, and it is the authority.

## Which rights the tools need

Each tool belongs to one API module; the integration needs that module's
access right plus the view or manage right matching what the tool does.

| Tools                                                                                | Module                   | To read                                            | To change                                                             |
| :----------------------------------------------------------------------------------- | :----------------------- | :------------------------------------------------- | :-------------------------------------------------------------------- |
| every tool                                                                           | Configurations générales | Se connecter avec des applications externes        | same                                                                  |
| `resources_*`, `teams_*`, `kinds_*`, `tags_*`                                        | Cœur RH                  | Accéder au module Cœur RH, Voir les collaborateurs | Gérer les collaborateurs (`tags_*` only read)                         |
| `schedules_*`, `absences_*`, `on_calls_*`, `schedule_templates_*`, `absence_types_*` | Planning                 | Accéder au module Planning, Voir les plannings     | Planifier; Gérer les modèles horaires (`absence_types_*` only read)   |
| `timechecks_*`                                                                       | Saisie des heures        | Voir les timbrages                                 | Valider l'ensemble des timbrages des personnes; Supprimer un timbrage |
| `work_regimes_*`                                                                     | Calcul des soldes        | Voir les soldes                                    |                                                                       |
| `projects_*`, `tasks_*`, `activities_*`, `day_tasks_*`                               | Activités                | the module's rights as shown on the screen         |                                                                       |

The tools never grant or revoke roles, the integration's own included:
`resources_list_roles` only reads who holds which role.

## The rights in the table

- **Se connecter avec des applications externes**: uses the public API; without it every call answers 401.
- **Accéder au module Cœur RH**: opens the module; needed by every other Cœur RH right.
- **Voir les collaborateurs**: people's professional, non-confidential information.
- **Gérer les collaborateurs**: creates and changes people and their contracts.
- **Accéder au module Planning**: opens the module; needed by every other Planning right.
- **Voir les plannings**: plannings and the list of schedules.
- **Planifier**: plans schedules and absences.
- **Gérer les modèles horaires**: adds, changes and deletes shift templates.
- **Voir les timbrages**: time check details.
- **Valider l'ensemble des timbrages des personnes**: validates and changes anyone's time checks, except one's own.
- **Supprimer un timbrage**: deletes a time check that is not validated yet.
- **Voir les soldes**: balances and their alerts.

## Rights that unlock confidential data

With these, Tipee stops redacting what they cover; tick them only when Claude
should see it.

- **Gérer les collaborateurs** and **Avoir accès à l'ensemble des données collaborateurs** (Cœur RH): people's confidential and secret data.
- **Planifier**, **Gérer les types d'absence**, **Voir les rapports (fériés, absences, soldes, etc.)** and **Voir les indemnités (variables pour salaires)** (Planning): confidential absences.
- **Valider l'ensemble des timbrages des personnes** (Saisie des heures): confidential absences.
- **Voir les soldes**, **Ajuster les soldes** and **Créer des bouclements de soldes** (Calcul des soldes): confidential absences.

## Rights to leave unticked

No tool needs them, and each would let the integration widen its own reach
or read more than any task calls for.

- **Gérer les rôles** (Configurations générales): creates roles and hands them out.
- **Assigner les rôles aux collaborateurs** (Cœur RH): changes who holds which role.
- **Gérer l'API** (Configurations générales): the API and integrations settings, keys included.
- **Accéder au journal d'audit** (Configurations générales): the history of every action on the instance.
