# Tipee rights, module by module

What an integration can do is the sum of the rights ticked on it at
`https://<instance>.tipee.net/hr-core/integrations`. The names below are
the ones shown on that screen, in the language of the admin panel.

## Which rights the tools need

Each tool belongs to one API module; the integration needs that module's
access right plus the view or manage right matching what the tool does.

| Tools                                                                                | Module                   | To read                                                                              | To change                                                             |
| :----------------------------------------------------------------------------------- | :----------------------- | :----------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| every tool                                                                           | Configurations générales | Se connecter avec des applications externes                                          | same                                                                  |
| `resources_*`, `teams_*`, `kinds_*`, `tags_*`                                        | Cœur RH                  | Accéder au module Cœur RH, Voir les collaborateurs                                   | Gérer les collaborateurs; Gérer les tags                              |
| `schedules_*`, `absences_*`, `on_calls_*`, `schedule_templates_*`, `absence_types_*` | Planning                 | Accéder au module Planning, Voir les plannings                                       | Planifier; Gérer les modèles horaires; Gérer les types d'absence      |
| `timechecks_*`                                                                       | Saisie des heures        | Voir les timbrages                                                                   | Valider l'ensemble des timbrages des personnes; Supprimer un timbrage |
| `work_regimes_*`                                                                     | Calcul des soldes        | Voir les soldes                                                                      |                                                                       |
| `projects_*`, `tasks_*`, `activities_*`, `day_tasks_*`                               | Activités                | the module's rights, listed on the screen once the module is enabled on the instance |                                                                       |

## Configurations générales

- **Afficher les modules non disponibles avec leurs teasers** — Permet de découvrir, en simple aperçu, tous les modules proposés par tipee, même s'ils ne sont pas activés sur votre instance.
- **Gérer les rôles** — Permet de créer, modifier et supprimer les rôles dans tipee, ainsi que de les attribuer. Ce droit, sensible, doit être accordé avec précaution.
- **Se connecter avec des applications externes** — Permet d'utiliser tipee go ainsi que les intégrations (API publique). Coché par défaut pour les intégrations.
- **Gérer les applications connectées aux comptes des collaborateurs** — Permet de configurer et gérer les accès à tipee go uniquement pour les autres collaborateurs auxquels j'ai accès aux paramètres. Ne permet pas de configurer pour soi-même.
- **Gérer les applications connectées à son propre compte tipee** — Permet de configurer et gérer les accès à tipee go pour soi-même uniquement.
- **Accéder aux configurations générales** — Permet de modifier les configurations de l'instance ainsi que de supprimer des personnes de l'annuaire.
- **Accéder au journal d'audit** — Permet la consultation de l'historique de toutes les actions effectuées sur l'instance. Ce droit, sensible, doit être accordé avec précaution.
- **Gérer l'API** — Permet d'accéder à l'espace de configuration de l'API et des intégrations.

## Tableau blanc

- **Voir le tableau blanc** — Permet de consulter l'espace de communication interne, où sont affichés des post-it partagés aux collaborateurs.
- **Gérer les post-its** — Permet la création, la modification et la suppression des post-its dans l'espace de communication interne.
- **Gérer les catégories de post-its** — Permet la création, la modification et la suppression des catégories utilisées pour organiser les post-its.

## Cœur RH

- **Accéder au module Cœur RH** — Autorise l'accès au module Cœur RH. Cette autorisation est nécessaire pour activer les autres autorisations du module.
- **Voir les résidents** — Permet de consulter les informations des résidents.
- **Gérer les résidents** — Permet la création et la modification des résidents, y compris la gestion de leurs contrats. La suppression nécessite l'autorisation "Accéder aux configurations générales".
- **Voir les collaborateurs** — Permet de consulter les informations professionnelles et non confidentielles des collaborateurs.
- **Gérer les collaborateurs** — Permet la création et la modification des collaborateurs, y compris la gestion de leurs contrats. Cette autorisation donne accès aux données confidentielles et secrètes des collaborateurs.
- **Avoir accès à l'ensemble des données collaborateurs** — Permet la consultation de l'ensemble des données collaborateurs (y compris les données confidentielles et secrètes).
- **Voir les clients** — Possibilité de consulter les informations des clients.
- **Gérer les clients** — Permet la création et la modification des clients, y compris la gestion de leurs contrats et de leurs secteurs. La suppression nécessite l'autorisation "Accéder aux configurations générales".
- **Voir les externes** — Permet de consulter les informations des externes.
- **Gérer les externes** — Permet la création et la modification des externes. La suppression nécessite l'autorisation "Accéder aux configurations générales".
- **Assigner les rôles aux collaborateurs** — Permet l'attribution ou la modification des rôles attribués aux collaborateurs.
- **Exporter toutes les données du Cœur RH** — Permet l'exportation en fichier CSV (Excel) de toutes les catégories de personnes du module Cœur RH : collaborateurs, clients, résidents, externes, etc.
- **Importer des collaborateurs** — Permet d'importer ou de mettre à jour des collaborateurs depuis un fichier CSV (Excel).
- **Importer des clients** — Permet d'importer ou de mettre à jour des clients depuis un fichier CSV (Excel).
- **Importer des résidents** — Permet d'importer ou de mettre à jour des résidents depuis un fichier CSV (Excel).
- **Voir les indicateurs RH** — Permet de consulter les indicateurs RH disponibles dans le Cœur RH.
- **Gérer les indicateurs RH** — Permet la gestion, la configuration et la personnalisation des indicateurs RH dans Cœur RH.
- **Configurer les numéros de regroupement de l'annuaire** — Permet la gestion des numéros de regroupement auxquels sont rattachés les collaborateurs et les secteurs dans l'annuaire.
- **Gérer le mode de saisie du temps des collaborateurs** — Permet de définir le mode de saisie de la qualification du temps ou des activités. Cela s'applique uniquement si le mode de saisie par collaborateur est activé dans les configurations générales.
- **Voir les ressources** — Permet de consulter les informations des ressources.
- **Gérer les ressources** — Permet la création et la modification des ressources, y compris la gestion de leurs contrats et de leurs secteurs. La suppression nécessite l'autorisation "Accéder aux configurations générales".
- **Gérer les tags** — Permet la création, la modification et l'archivage des tags.
- **Gérer les intégrations** — Permet la création et la modification des intégrations. La suppression nécessite l'autorisation "Accéder aux configurations générales".
- **Voir les intégrations** — Possibilité de consulter les informations des intégrations.

## Planning

- **Accéder au module Planning** — Autorise l'accès au module Planning. Cette autorisation est nécessaire pour utiliser les autres autorisations du module.
- **Voir les plannings** — Permet de voir les plannings, consulter et imprimer la liste des horaires.
- **Voir son propre planning** — Permet de voir mon planning selon mes contrats de secteur.
- **Planifier** — Permet de planifier horaires et absences, ainsi que de voir les absences confidentielles.
- **Gérer les planifications groupées** — Permet de gérer les planifications groupées.
- **Gérer les communications dans les Plannings** — Permet d'ajouter, modifier et supprimer une communication dans les plannings.
- **Bloquer les plannings** — Permet de bloquer les plannings de toute saisie de planification ou saisie des heures.
- **Débloquer les plannings** — Permet de débloquer les plannings.
- **Masquer et démasquer les plannings** — Permet de masquer et démasquer les plannings.
- **Planifier des horaires pour soi-même** — Permet de planifier des horaires pour soi-même.
- **Planifier des absences pour soi-même** — Permet de planifier les absences autorisées pour soi-même.
- **Gérer les modèles horaires** — Permet d'ajouter, modifier et supprimer un modèle horaire.
- **Gérer les types d'absence** — Permet de créer/modifier/supprimer des types d'absence et de les configurer. Permet de voir les absences confidentielles dans le planning.
- **Voir les rapports (fériés, absences, soldes, etc.)** — Permet de voir les rapports d'occurrences, des soldes et des bilans et de voir les absences confidentielles.
- **Voir les indemnités (variables pour salaires)** — Permet de voir les indemnités (variables pour salaires), et de voir les absences confidentielles.
- **Gérer les jours fériés** — Permet d'ajouter, modifier, supprimer les jours fériés.
- **Gérer les taux d'encadrement** — Permet de gérer les périodes de taux d'encadrement. Ceux-ci doivent être activés dans votre tipee.
- **Faire une demande d'absence**
- **Voir les demandes d'absence en attente de validation des collègues dans le planning** — Permet de voir les demandes d'absence en attente de validation des collègues dans le planning.
- **Valider les demandes d'absence** — Permet de prévalider et valider les demandes d'absence, y compris de prendre la main sur celles d'autres responsables. Permet également la prévalidation des demandes nécessitant une étape de validation supplémentaire obligatoire.
- **Valider les demandes d'absence sur 2 niveaux** — Permet de valider les demandes d'absences, y compris celles pour lesquelles une étape de validation supplémentaire est obligatoire. Permet de prendre la main sur tous les types de demandes d'absence.
- **Gérer les demandes d'absence** — Permet de valider les demandes d'absence, y compris celles pour lesquelles une étape de validation supplémentaire est obligatoire. Permet de prendre la main sur tous les types de demandes d'absence ainsi que de voir tous les documents liés aux demandes d'absence. N'apparaît pas dans la liste des validateurs lors de la création d'une demande.
- **Gérer les demandes d'absence par type** — Permet l'activation ou la désactivation des demandes d'absence pour un type d'absence donné.
- **Voir les compensations de soldes** — Permet de voir les compensations de soldes.

## Saisie des heures

- **Accès au timbrage** — Cette autorisation est nécessaire pour pouvoir saisir ses heures ; seule, elle n'ouvre aucune fonctionnalité et doit être associée à d'autres autorisations.
- **Voir les timbrages** — Permet d'accéder aux détails des timbrages dans le planning et dans le présencier (si l'autorisation "Consulter le présencier" est activée).
- **Valider l'ensemble des timbrages des personnes** — Permet de valider et de modifier l'ensemble des timbrages d'une personne et de voir les absences confidentielles. Vous ne pouvez pas valider vos propres timbrages avec cette autorisation.
- **Valider uniquement les timbrages d'un secteur spécifique** — Permet de valider et de modifier les timbrages liés à un secteur spécifique. Vous ne pouvez pas valider vos propres timbrages avec cette autorisation.
- **Valider ses propres timbrages** — Permet de valider ses propres timbrages.
- **Supprimer un timbrage** — Permet la suppression d'un timbrage, à l'exception de ceux déjà validés.
- **Administrer des timbreuses** — Permet de configurer les timbreuses et attribuer les badges.
- **Proposer des timbrages pour soi-même** — Ouvre l'accès à la page "Saisie des heures" > "Ma journée". Permet d'effectuer des saisies manuelles des heures (proposition de timbrage) ou de modifier des timbrages existants, tant que les journées ne sont pas validées.
- **Consulter le présencier** — Permet l'accès au présencier pour visualiser les collaborateurs présents. Cette autorisation seule n'inclut pas la consultation des heures d'arrivée.
- **Timbrer depuis l'application web** — Permet de timbrer dans tipee depuis l'application web (ordinateur et tablette).
- **Timbrer depuis l'application web sur un téléphone** — Permet de timbrer depuis l'application web sur un téléphone.
- **Timbrer depuis l'application mobile tipee go** — Permet de timbrer depuis l'application mobile tipee go, uniquement à proximité d'une balise configurée par tipee. Une autre autorisation peut être activée pour timbrer sans balise. Une autorisation "Gérer les applications connectées" est nécessaire pour lier l'application tipee go à un compte tipee.
- **Timbrer depuis l'application mobile tipee go sans balise** — Permet de timbrer avec l'application mobile tipee go sans balise à proximité.

## Calcul des soldes

- **Voir ses propres soldes** — Permet de voir ses propres soldes (accès au résumé personnel). Nécessaire pour le fonctionnement de l'application mobile tipee go.
- **Voir les soldes** — Permet de voir les soldes (d'accéder aux résumés personnels), consulter les alertes (repos quotidien et hebdo, heures hebdo max, etc.) sur le planning par secteur et voir les absences confidentielles.
- **Ajuster les soldes** — Permet d'ajuster les soldes et de voir les absences confidentielles.
- **Définir le mode de calcul des soldes** — Permet la configuration du mode de calcul des soldes d'un collaborateur, incluant les paramètres des jauges de travail et la prise en compte des heures travaillées (planifications prises en compte, planification uniquement, timbrages uniquement).
- **Gérer les variables compteurs des collaborateurs** — Permet la création et la modification de variables compteurs servant au suivi spécifique, par exemple pour les majorations, le télétravail ou encore le THPE.
- **Créer des bouclements de soldes** — Permet de créer un bouclement de solde, et de voir les absences confidentielles.
- **Modifier des bouclements de soldes** — Permet d'éditer un bouclement de solde.
- **Créer et supprimer des régimes de travail ou de vacances** — Permet la création, la suppression et l'activation de régimes de travail ou de vacances sur l'instance. Permet également de modifier des régimes non attribués.
- **Modifier des régimes de travail ou de vacances** — Permet la modification des régimes de travail ou de vacances déjà attribués à des sites, des secteurs ou des personnes.
- **Attribuer des régimes de travail ou de vacances** — Permet l'attribution d'un régime de travail ou de vacances à des sites ou des secteurs.

## Entretiens

- **Accès au module Entretiens** — Permet d'accéder au module Entretiens.
- **Être responsable d'un entretien** — Permet d'être défini comme responsable d'un entretien sur les secteurs octroyés.
- **Créer un entretien** — Permet de créer un nouvel entretien en définissant ses participants, sa date et son questionnaire.
- **Voir les entretiens** — Donne accès à la visualisation et au suivi des entretiens sur les secteurs octroyés.
- **Gérer les entretiens** — Permet de voir, créer, modifier et supprimer les entretiens sur les secteurs octroyés.
- **Révoquer une validation ou supprimer un entretien approuvé** — Permet, à titre exceptionnel, de révoquer une validation d'un entretien terminé et dont le compte rendu a été approuvé par la personne invitée. Permet également de détruire un entretien peu importe son statut.
- **Gérer les modèles d'entretiens** — Permet de créer, modifier et supprimer les modèles d'entretiens.
- **Gérer le catalogue de questions** — Permet de créer, modifier et supprimer des questions dans le catalogue.
- **Voir les campagnes d'entretiens** — Donne accès à la visualisation et au suivi des campagnes d'entretiens.
- **Gérer les campagnes d'entretiens** — Permet de voir, créer, modifier et supprimer les campagnes d'entretiens.
- **Mettre à jour ses objectifs** — Permet d'éditer le statut et la progression ainsi que d'ajouter des observations.
- **Gérer ses propres objectifs** — Donne accès à la création, l'édition et la suppression de ses propres objectifs.
- **Gérer les objectifs de ses équipes** — Donne accès à la création, l'édition et la suppression des objectifs de ses équipes. Cette autorisation ne permet pas de gérer ses propres objectifs.

## Qualité

- **Accès au module Qualité**
- **Gestion d'un document** — Permet l'ajout, la modification, la suppression d'un document Qualité, ainsi que l'activation et la désactivation de ce dernier.
- **Gestion de l'arborescence de la qualité** — Permet l'ajout, la modification, la suppression de domaines et de processus.
- **Voir la liste des améliorations** — Permet d'accéder à la liste des améliorations.
- **Proposer une amélioration** — Permet de proposer une amélioration.
- **Modifier une amélioration / Prendre une décision / Supprimer une amélioration** — Permet de modifier une amélioration, de prendre une décision et de supprimer l'amélioration.

## Documents

- **Accès au module document RH**
- **Ajouter des documents RH à soi-même**
- **Voir ses propres documents RH**
- **Voir les documents des employés**
- **Administrer les documents des employés** — Permet d'ajouter, remplacer, déplacer, supprimer, modifier la visibilité des documents utilisateur et l'ajout, suppression, modification des notes utilisateur.
- **Gérer l'arborescence des répertoires pour les employés** — Permet d'ajouter, renommer, déplacer, supprimer les répertoires de l'arborescence pour les utilisateurs.
- **Voir les documents des employés archivés** — Permet de voir et modifier les documents pour les employés archivés.
- **Voir les documents de clients** — Possibilité de voir les documents des clients pour les secteurs autorisés.
- **Administrer les documents de clients** — Permet d'ajouter, remplacer, déplacer, supprimer des documents clients et l'ajout, suppression, modification des notes clients.
- **Modifier l'arborescence des documents de clients** — Permet de modifier l'arborescence des documents clients.
- **Voir les documents des clients archivés** — Permet de voir et modifier les documents pour les clients archivés.
- **Voir les documents de résidents** — Possibilité de voir les documents des résidents pour les secteurs autorisés.
- **Administrer les documents de résidents** — Permet d'ajouter, remplacer, déplacer, supprimer des documents résidents et l'ajout, suppression, modification des notes résidents.
- **Modifier l'arborescence des documents de résidents** — Permet de modifier l'arborescence des documents résidents.
- **Voir les documents des résidents archivés** — Permet de voir et modifier les documents pour les résidents archivés.
- **Voir les documents de ressources** — Possibilité de voir les documents de ressources pour les secteurs autorisés.
- **Administrer les documents de ressources** — Permet d'ajouter, remplacer, déplacer, supprimer des documents de ressources et l'ajout, suppression, modification des notes pour les ressources.
- **Modifier l'arborescence des documents de ressources** — Permet de modifier l'arborescence des documents de ressources.
- **Voir les documents des ressources archivées** — Permet de voir et modifier les documents pour les ressources archivées.
- **Voir les documents des externes** — Possibilité de voir les documents pour les externes.
- **Administrer les documents des externes** — Permet d'ajouter, remplacer, déplacer, supprimer des documents pour les externes et l'ajout, suppression, modification des notes pour les externes.
- **Modifier l'arborescence des documents des externes** — Permet de modifier l'arborescence des documents pour les externes.
- **Voir les documents de secteur** — Possibilité de voir les documents des secteurs autorisés.
- **Administrer les documents de secteur** — Permet d'ajouter, remplacer, déplacer, supprimer des documents pour le secteur autorisé.
