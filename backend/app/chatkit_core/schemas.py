"""Schémas Pydantic utilisés par le noyau ChatKit."""

from __future__ import annotations

from pydantic import BaseModel


class TriageSchema(BaseModel):
    """Résultat structuré du premier tri effectué par le workflow."""

    has_all_details: bool
    details_manquants: str


class RDacteurSchemaIntroPlaceCours(BaseModel):
    """Introduction décrivant la place du cours dans le programme."""

    texte: str


class RDacteurSchemaObjectifTerminal(BaseModel):
    """Objectif terminal du plan-cadre."""

    texte: str


class RDacteurSchemaStructureIntro(BaseModel):
    """Résumé de la structure générale du cours."""

    texte: str


class RDacteurSchemaActivitesTheoriques(BaseModel):
    """Description des activités théoriques proposées."""

    texte: str


class RDacteurSchemaActivitesPratiques(BaseModel):
    """Description des activités pratiques prévues."""

    texte: str


class RDacteurSchemaActivitesPrevuesItem(BaseModel):
    """Activité prévue dans le déroulé du cours."""

    phase: str
    description: str


class RDacteurSchemaEvaluationSommative(BaseModel):
    """Modalités d'évaluation sommative."""

    texte: str


class RDacteurSchemaNatureEvaluationsSommatives(BaseModel):
    """Nature des évaluations sommatives utilisées."""

    texte: str


class RDacteurSchemaEvaluationLangue(BaseModel):
    """Modalités spécifiques liées à l'évaluation de la langue."""

    texte: str


class RDacteurSchemaEvaluationFormative(BaseModel):
    """Modalités d'évaluation formative."""

    texte: str


class RDacteurSchemaCompetencesDeveloppeesItem(BaseModel):
    """Compétence développée dans le cours."""

    texte: str
    description: str


class RDacteurSchemaCompetencesCertifieesItem(BaseModel):
    """Compétence certifiée par le cours."""

    texte: str
    description: str


class RDacteurSchemaCoursCorequisItem(BaseModel):
    """Cours corequis à considérer dans le plan-cadre."""

    texte: str
    description: str


class RDacteurSchemaObjetsCiblesItem(BaseModel):
    """Objet ciblé par l'apprentissage."""

    texte: str
    description: str


class RDacteurSchemaCoursReliesItem(BaseModel):
    """Cours relié partageant la même compétence."""

    texte: str
    description: str


class RDacteurSchemaCoursPrealablesItem(BaseModel):
    """Cours préalable nécessaire."""

    texte: str
    description: str


class RDacteurSchemaSavoirsFaireCapaciteItem(BaseModel):
    """Savoir-faire associé à une capacité donnée."""

    savoir_faire: str
    cible_100: str
    seuil_60: str


class RDacteurSchemaCapaciteItem(BaseModel):
    """Capacité développée par le cours."""

    capacite: str
    pond_min: float
    pond_max: float
    savoirs_necessaires_capacite: list[str]
    savoirs_faire_capacite: list[RDacteurSchemaSavoirsFaireCapaciteItem]
    moyens_evaluation_capacite: list[str]


class RDacteurSchema(BaseModel):
    """Schéma complet produit par l'agent Rédacteur."""

    intro_place_cours: RDacteurSchemaIntroPlaceCours
    objectif_terminal: RDacteurSchemaObjectifTerminal
    structure_intro: RDacteurSchemaStructureIntro
    activites_theoriques: RDacteurSchemaActivitesTheoriques
    activites_pratiques: RDacteurSchemaActivitesPratiques
    activites_prevues: list[RDacteurSchemaActivitesPrevuesItem]
    evaluation_sommative: RDacteurSchemaEvaluationSommative
    nature_evaluations_sommatives: RDacteurSchemaNatureEvaluationsSommatives
    evaluation_langue: RDacteurSchemaEvaluationLangue
    evaluation_formative: RDacteurSchemaEvaluationFormative
    competences_developpees: list[RDacteurSchemaCompetencesDeveloppeesItem]
    competences_certifiees: list[RDacteurSchemaCompetencesCertifieesItem]
    cours_corequis: list[RDacteurSchemaCoursCorequisItem]
    objets_cibles: list[RDacteurSchemaObjetsCiblesItem]
    cours_relies: list[RDacteurSchemaCoursReliesItem]
    cours_prealables: list[RDacteurSchemaCoursPrealablesItem]
    savoir_etre: list[str]
    capacite: list[RDacteurSchemaCapaciteItem]


class Triage2Schema(BaseModel):
    """Résultat structuré du second tri du workflow."""

    has_all_details: bool
    details_manquants: str


__all__ = [
    "TriageSchema",
    "Triage2Schema",
    "RDacteurSchema",
    "RDacteurSchemaIntroPlaceCours",
    "RDacteurSchemaObjectifTerminal",
    "RDacteurSchemaStructureIntro",
    "RDacteurSchemaActivitesTheoriques",
    "RDacteurSchemaActivitesPratiques",
    "RDacteurSchemaActivitesPrevuesItem",
    "RDacteurSchemaEvaluationSommative",
    "RDacteurSchemaNatureEvaluationsSommatives",
    "RDacteurSchemaEvaluationLangue",
    "RDacteurSchemaEvaluationFormative",
    "RDacteurSchemaCompetencesDeveloppeesItem",
    "RDacteurSchemaCompetencesCertifieesItem",
    "RDacteurSchemaCoursCorequisItem",
    "RDacteurSchemaObjetsCiblesItem",
    "RDacteurSchemaCoursReliesItem",
    "RDacteurSchemaCoursPrealablesItem",
    "RDacteurSchemaSavoirsFaireCapaciteItem",
    "RDacteurSchemaCapaciteItem",
]
