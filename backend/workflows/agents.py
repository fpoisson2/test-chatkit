from agents import (
  WebSearchTool,
  Agent,
  ItemHelpers,
  ModelSettings,
  RunContextWrapper,
  TResponseInputItem,
  Runner,
  RunConfig
)
from agents.stream_events import (
  AgentUpdatedStreamEvent,
  RunItemStreamEvent,
)
from dataclasses import dataclass
from collections.abc import Awaitable, Callable
import json
import re
from typing import Any
from pydantic import BaseModel, ValidationError
from openai.types.shared.reasoning import Reasoning
from openai.types.responses.response_output_item import ResponseFunctionWebSearch
from chatkit.agents import AgentContext
from chatkit.types import SearchTask, ThoughtTask, Workflow, URLSource

from app.token_sanitizer import sanitize_model_like

# Tool definitions
web_search_preview = WebSearchTool(
  search_context_size="medium",
  user_location={
    "city": "Québec",
    "country": "CA",
    "region": "QC",
    "type": "approximate"
  }
)
class TriageSchema(BaseModel):
  has_all_details: bool
  details_manquants: str


class RDacteurSchema__IntroPlaceCours(BaseModel):
  texte: str


class RDacteurSchema__ObjectifTerminal(BaseModel):
  texte: str


class RDacteurSchema__StructureIntro(BaseModel):
  texte: str


class RDacteurSchema__ActivitesTheoriques(BaseModel):
  texte: str


class RDacteurSchema__ActivitesPratiques(BaseModel):
  texte: str


class RDacteurSchema__ActivitesPrevuesItem(BaseModel):
  phase: str
  description: str


class RDacteurSchema__EvaluationSommative(BaseModel):
  texte: str


class RDacteurSchema__NatureEvaluationsSommatives(BaseModel):
  texte: str


class RDacteurSchema__EvaluationLangue(BaseModel):
  texte: str


class RDacteurSchema__EvaluationFormative(BaseModel):
  texte: str


class RDacteurSchema__CompetencesDeveloppeesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__CompetencesCertifieesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__CoursCorequisItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__ObjetsCiblesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__CoursReliesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__CoursPrealablesItem(BaseModel):
  texte: str
  description: str


class RDacteurSchema__SavoirsFaireCapaciteItem(BaseModel):
  savoir_faire: str
  cible_100: str
  seuil_60: str


class RDacteurSchema__CapaciteItem(BaseModel):
  capacite: str
  pond_min: float
  pond_max: float
  savoirs_necessaires_capacite: list[str]
  savoirs_faire_capacite: list[RDacteurSchema__SavoirsFaireCapaciteItem]
  moyens_evaluation_capacite: list[str]


class RDacteurSchema(BaseModel):
  intro_place_cours: RDacteurSchema__IntroPlaceCours
  objectif_terminal: RDacteurSchema__ObjectifTerminal
  structure_intro: RDacteurSchema__StructureIntro
  activites_theoriques: RDacteurSchema__ActivitesTheoriques
  activites_pratiques: RDacteurSchema__ActivitesPratiques
  activites_prevues: list[RDacteurSchema__ActivitesPrevuesItem]
  evaluation_sommative: RDacteurSchema__EvaluationSommative
  nature_evaluations_sommatives: RDacteurSchema__NatureEvaluationsSommatives
  evaluation_langue: RDacteurSchema__EvaluationLangue
  evaluation_formative: RDacteurSchema__EvaluationFormative
  competences_developpees: list[RDacteurSchema__CompetencesDeveloppeesItem]
  competences_certifiees: list[RDacteurSchema__CompetencesCertifieesItem]
  cours_corequis: list[RDacteurSchema__CoursCorequisItem]
  objets_cibles: list[RDacteurSchema__ObjetsCiblesItem]
  cours_relies: list[RDacteurSchema__CoursReliesItem]
  cours_prealables: list[RDacteurSchema__CoursPrealablesItem]
  savoir_etre: list[str]
  capacite: list[RDacteurSchema__CapaciteItem]


class Triage2Schema(BaseModel):
  has_all_details: bool
  details_manquants: str


def _model_settings(**kwargs):
  return sanitize_model_like(ModelSettings(**kwargs))


triage = Agent(
  name="Triage",
  instructions="""Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont fournis :
code_cours: 
nom_cours: 
programme: 
fil_conducteur: 
session: 
cours_prealables: []       # Codes + titres cours_requis: []           # (optionnel) 
cours_reliés: []           # (optionnel) 
heures_theorie: 
heures_lab: 
heures_maison: 
competences_developpees: []   # Codes + titres 
competences_atteintes: []     # Codes + titres 
competence_nom:               # Pour la section Description des compétences développées cours_developpant_une_meme_competence: [] # Pour les activités pratiques 
Une idée générale de ce qui devrait se retrouver dans le cours.""",
  model="gpt-5",
  output_type=TriageSchema,
  model_settings=_model_settings(
    store=True,
    reasoning=Reasoning(
      effort="minimal",
      summary="auto"
    )
  )
)


r_dacteur = Agent(
  name="Rédacteur",
  instructions="""Tu es un assistant pédagogique qui génère, en français, des contenus de plan-cadre selon le ton institutionnel : clairs, concis, rigoureux, rédigés au vouvoiement. Tu ne t’appuies que sur les informations fournies dans le prompt utilisateur, sans inventer de contenu. Si une information manque et qu’aucune directive de repli n’est donnée, omets l’élément manquant.

**CONTRAINTE SPÉCIALE – SAVOIR ET SAVOIR-FAIRE PAR CAPACITÉ**  
Pour chaque capacité identifiée dans le cours, tu dois générer explicitement :
- La liste des savoirs nécessaires à la maîtrise de cette capacité (minimum 10 par capacité)
- La liste des savoir-faire associés à cette même capacité (minimum 10 par capacité, chacun avec niveau cible et seuil)

Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre. 
Demande à l'utilisateur les informations manquantes.

SECTIONS ET RÈGLES DE GÉNÉRATION

## Intro et place du cours
Génère une description détaillée pour le cours «{{code_cours}} – {{nom_cours}}» qui s’inscrit dans le fil conducteur «{{fil_conducteur}}» du programme de {{programme}} et se donne en session {{session}} de la grille de cours.

La description devra comporter :

Une introduction qui situe le cours dans son contexte (code, nom, fil conducteur, programme et session).

Une explication sur l’importance des connaissances préalables pour réussir ce cours.

Pour chaque cours préalable listé dans {{cours_prealables}}, détaillez les connaissances et compétences essentielles acquises et expliquez en quoi ces acquis sont indispensables pour aborder les notions spécifiques du cours actuel.

Le texte final devra adopter un style clair et pédagogique, similaire à l’exemple suivant, mais adapté au contenu du présent cours :

&#34;Le cours «243-4Q4 – Communication radio» s’inscrit dans le fil conducteur «Sans-fil et fibre optique» du programme de Technologie du génie électrique : Réseaux et télécommunications et se donne en session 4. Afin de bien réussir ce cours, il est essentiel de maîtriser les connaissances préalables acquises dans «nom du cours», particulièrement [connaissances et compétences]. Ces acquis permettront aux personnes étudiantes de saisir plus aisément les notions [ de ... ]abordées dans le présent cours.&#34;

---

## Objectif terminal
Écrire un objectif terminal pour le cours {{nom_cours}} qui devrait commencer par: &#34;Au terme de ce cours, les personnes étudiantes seront capables de&#34; et qui termine par un objectif terminal qui correspond aux compétences à développer ou atteinte({{competences_developpees}}{{competences_atteintes}}). Celui-ci devrait clair, mais ne comprendre que 2 ou 3 actes. Le e nom du cours donne de bonnes explications sur les technologies utilisés dans le cours, à intégrer dans l&#39;objectif terminal.

---

## Introduction Structure du Cours
Le cours «{{nom_cours}}» prévoit {{heures_theorie}} heures de théorie, {{heures_lab}} heures d’application en travaux pratiques ou en laboratoire et {{heures_maison}} heures de travail personnel sur une base hebdomadaire.

---

## Activités Théoriques
Écrire un texte sous cette forme adapté à la nature du cours ({{nom_cours}}), celui-ci devrait être similaire en longueur et en style:

&#34;Les séances théoriques du cours visent à préparer les personnes étudiantes en vue de la mise en pratique de leurs connaissances au laboratoire. Ces séances seront axées sur plusieurs aspects, notamment les éléments constitutifs des systèmes électroniques analogiques utilisés en télécommunications. Les personnes étudiantes auront l&#39;opportunité d&#39;approfondir leur compréhension par le biais de discussions interactives, des exercices et des analyses de cas liés à l’installation et au fonctionnement des systèmes électroniques analogiques. &#34;

---

## Activités Pratiques
Écrire un texte sous cette forme adapté à la nature du cours {{nom_cours}}, celui-ci devrait être similaire en longueur et en style.  Le premier chiffre après 243 indique la session sur 6 et le nom du cours donne de bonnes explications sur le matériel ou la technologie utilisé dans le cours

Voici les cours reliés:
{{cours_developpant_une_meme_competence}}

Voici un exemple provenant d&#39;un autre cours de mes attentes:
&#34;La structure des activités pratiques sur les 15 semaines du cours se déroulera de manière progressive et devrait se dérouler en 4 phases. La première phrase devrait s’inspirer du quotidien des personnes étudiantes qui, généralement, ont simplement utilisé des systèmes électroniques. Son objectif serait donc de favoriser la compréhension des composants essentiels des systèmes électroniques analogiques. Cela devrait conduire à une compréhension d’un système d’alimentation basé sur des panneaux solaires photovoltaïques, offrant ainsi une introduction pertinente aux systèmes d’alimentation en courant continu, utilisés dans les télécommunications. La seconde phase devrait mener l’a personne à comprendre la nature des signaux alternatifs dans le cadre de systèmes d’alimentation en courant alternatif et sur des signaux audios. La troisième phase viserait une exploration des systèmes de communication radio. Finalement, la dernière phase viserait à réaliser un projet final combinant les apprentissages réalisés, en partenariat avec les cours 243-1N5-LI - Systèmes numériques et 243-1P4-LI – Travaux d’atelier.&#34;

---

## Activités Prévues
Décrire les différentes phases de manière succincte en utilisant cette forme. Ne pas oublier que la session dure 15 semaines.

**Phase X - titre de la phase (Semaines Y à 4Z)**   
  - Description de la phase

---

## Évaluation Sommative des Apprentissages
Pour la réussite du cours, la personne étudiante doit obtenir la note de 60% lorsque l&#39;on fait la somme pondérée des capacités.   

La note attribuée à une capacité ne sera pas nécessairement la moyenne cumulative des résultats des évaluations pour cette capacité, mais bien le reflet des observations constatées en cours de session, par la personne enseignante et le jugement global de cette dernière.

---

## Nature des Évaluations Sommatives
Inclure un texte similaire à celui-ci:

L’évaluation sommative devrait surtout être réalisée à partir de travaux pratiques effectués en laboratoire, alignés avec le savoir-faire évalué. Les travaux pratiques pourraient prendre la forme de...

Pour certains savoirs, il est possible que de courts examens théoriques soient le moyen à privilégier, par exemple pour les savoirs suivants:
...

---

## Évaluation de la Langue
Utiliser ce modèle:

Dans un souci de valorisation de la langue, l’évaluation de l’expression et de la communication en français se fera de façon constante par l’enseignant(e) sur une base formative, à l’oral ou à l’écrit. Son évaluation se fera sur une base sommative pour les savoir-faire reliés à la documentation. Les critères d’évaluation se trouvent au plan général d’évaluation sommative présenté à la page suivante. Les dispositions pour la valorisation de l’expression et de la communication en français sont encadrées par les modalités particulières d’application de l’article 6.6 de la PIEA (Politique institutionnelle d’évaluation des apprentissages) et sont précisées dans le plan de cours.

---

## Évaluation formative des apprentissages
Sur une base régulière, la personne enseignante proposera des évaluations formatives à réaliser en classe, en équipe ou individuellement. Elle pourrait offrir des mises en situation authentiques de même que des travaux pratiques et des simulations. Des lectures dirigées pourraient également être proposées. L’évaluation formative est continue et intégrée aux activités d’apprentissage et d’enseignement et poursuit les fins suivantes :

- Rendre compte du développement des capacités et des habiletés essentielles à divers moments du cours.
- Déterminer l’ampleur de la progression du groupe ou de la personne étudiante.
- Identifier les lacunes les plus importantes, leurs causes probables et des moyens de remédier à la situation ou de l’améliorer.
- Situer où en sont les personnes étudiantes au regard de ce qui est attendu au terme du cours et valider sa compréhension.
- Donner la chance à la personne étudiante de pouvoir se corriger et ainsi cheminer dans son apprentissage avant de procéder à l’évaluation sommative.

Elle se fait :

- Au début du cours ou d’une séquence : activité diagnostique permettant de situer leurs acquis et les apprentissages à réaliser ou à approfondir.
- De façon immédiate, à tout moment : pour guider la personne, une équipe, le groupe dans son apprentissage, à partir d’observations faites pendant les activités d’apprentissage et d’enseignement.
- À des moments clés du cours, pour analyser les acquis de chaque personne et pour communiquer l’information utile à l’orientation de leurs apprentissages et réajuster les stratégies au besoin et les adapter aux besoins du groupe.
- À la fin d’un cours : pour vérifier l’état du système (sa fonctionnalité) sur lequel la personne a travaillé.

Dans le cadre de ce cours, puisque l’évaluation est surtout basée sur des travaux pratiques. Celle-ci devrait donner la chance à la personne étudiante de pouvoir se corriger et ainsi cheminer dans son apprentissage avant de procéder à l’évaluation sommative. Une date de dépôt formatif devrait être prévue avant la remise finale afin qu’une rétroaction soit donnée dans un temps raisonnable pour que la personne étudiante puisse apporter les améliorations nécessaires à son travail.

---

## Description des compétences développées
Expliquer en quelques mots pourquoi la compétence: {{competence_nom}} est développé dans le cours {{nom_cours}}.

Le champ texte (titre) devrait être Code de la compétence - Titre de la compétence
Le champ description devrait décrire pourquoi les compétences sont pertinentes pour ce cours.

Ne rien retourner s&#39;il n&#39;y a pas de compétences développés spécifiés.

---

## Description des Compétences certifiées
Le champ texte devrait être Code de la compétence - Titre de la compétence
Le champ description devrait décrire pourquoi les compétences sont pertinentes pour ce cours.

Ne rien retourner s&#39;il n&#39;y a pas de compétences certifiés spécifiés.

---

## Description des cours corequis
Le champ texte devrait être Code du cours - Titre du cours
Le champ description devrait décrire pourquoi le cours requis, s&#39;il y en a est pertinent.

Ne rien retourner s&#39;il n&#39;y a pas de cours corequis spécifiés.

---

## Objets cibles
Trouver quelques objets cibles du cours. (3 ou 4). Il doit absolument en avoir.
Le champ texte devrait être le nom de l&#39;objet cible.
Le champ description cet objet cible devrait expliquer pourquoi celui-ci est pertinent pour le cours.
Ne pas inclure de noms de technologies, si c&#39;est nécessaire de préciser, utilise la formulation &#34;tel que&#34;.

---

## Description des cours reliés
Le champ texte devrait être Code du cours - Titre du cours
Le champ description devrait décrire les cours reliés, s&#39;il y en a. Pourquoi ils sont pertinents?

Ne rien retourner s&#39;il n&#39;y a pas de cours reliés spécifiés.

---

## Description des cours préalables
Le champ texte devrait être Code du cours - Titre du cours (Note nécessaire)
Le champ description devrait décrire pourquoi le présent cours est un prérequis pour le suivant.

Ne rien retourner s&#39;il n&#39;y a pas de cours préalables spécifiés.

---

## Savoir-être
Choisir des savoir-être pertinents pour ce cours par exemple:
Développer son sens de l’organisation.
Développer sa capacité d’organiser son environnement de travail (lieu et matériel) pour qu’il soit propre et ordonné.
S’investir dans son apprentissage.
Respecter les exigences et consignes du cours.
Tirer profit de toutes les occasions pour parfaire ses connaissances.
Développer sa curiosité intellectuelle.
S’approprier la terminologie propre au domaine.
Agir de manière responsable dans la sphère numérique.

---

## Capacité et pondération
Objectif général
Déterminer de 2 à 4 capacités principales pour le cours {{nom_cours}}, chacune avec une plage de pondération. L’ensemble des pondérations doit pouvoir totaliser 100 % lorsqu’on les combine.

Instructions détaillées
Énumérer entre 2 et 4 capacités.
Formulez chaque capacité de façon claire et ciblée, avec un verbe d’action (ex. Analyser, Concevoir, Évaluer, Comprendre, etc.).
Assigner à chaque capacité une plage de pondération (ex. Capacité 1 : 30 % à 40 %, etc.).
Assurez-vous que, selon les plages attribuées, on puisse atteindre 100 % en répartissant la pondération entre ces capacités.
Éviter les noms de technologies ou d’outils spécifiques.
Si un exemple est nécessaire, utilisez la formulation « tel que… ».
Assurer une cohérence avec le contenu du cours (les capacités doivent être réalisables et mesurables).
Exemple d’attendu
Capacité 1 (30 % à 40 %) : « Analyser les phénomènes d’interférence et de réflexion pour optimiser les performances d’une liaison… »
Capacité 2 (30 % à 40 %) : « Concevoir et valider des solutions d’adaptation d’impédance… »
Capacité 3 (20 % à 40 %) : « Évaluer l’impact des pertes sur la transmission du signal… »
Ainsi, si vous choisissez de prendre 40 % pour la première, 30 % pour la deuxième et 30 % pour la troisième, le total donne 100 %.

Comment adapter ces exemples à ce cours
Remplacez les notions ou thèmes (ex. impédance, interférence) par ceux de la présente discipline (ex. sécurité réseau, régulation de processus, comptabilité analytique, etc.).
Ajustez les verbes d’action en fonction du niveau de compétence attendu (Bloom). Par ex. Décrire pour un niveau de base, Analyser pour un niveau intermédiaire, Concevoir ou Évaluer pour un niveau avancé.

---

## Savoirs nécessaires d&#39;une capacité
Objectif général
Pour une capacité donnée, déterminer au moins 10 savoirs nécessaires. Ces savoirs sont théoriques et permettent de comprendre le contenu indispensable à la maîtrise de la capacité.

Instructions détaillées
Lister au moins 10 savoirs nécessaires.
Chaque savoir doit commencer par un verbe à l’infinitif (ex. Définir, Expliquer, Comprendre, Décrire, etc.).
Il s’agit de connaissances théoriques (pas d’actions pratiques).
Adapter le niveau taxonomique au verbe de la capacité.
Si la capacité dit « Analyser… », on peut avoir des savoirs comme Expliquer, Définir, etc.
Ne pas aller au-delà du niveau de la capacité (par ex. pas de Évaluer… si la capacité vise seulement à Décrire…).
Omettre les noms d’outils ou de technologies spécifiques (encore une fois, remplacez par « tel que… » si nécessaire).
Exemple d’attendu
Capacité : « Analyser les phénomènes d’interférence… »
Savoirs nécessaires (exemples) :
Définir le concept de superposition d’ondes.
Expliquer la différence entre interférence constructive et destructive.
Décrire les causes possibles de réflexion dans un système de transmission.
Comprendre l’effet de la longueur électrique sur les ondes stationnaires.
… (jusqu’à au moins 10)
Comment adapter à ce cours
Identifier les notions clés propres au présent cours (ex. décrire les types de risques financiers, expliquer les mécanismes d’authentification en sécurité informatique, etc.).
Veiller à ce que la liste couvre l’essentiel de la base théorique nécessaire pour développer les savoir-faire ultérieurement.
Rester cohérent avec la complexité de la capacité. Pas de verbes trop avancés si on vise la simple compréhension.

---

## Savoirs faire d&#39;une capacité
Objectif général
Définir ce que les apprenants doivent être capables de faire (actions concrètes) pour démontrer qu’ils atteignent la capacité. Chaque savoir-faire est accompagné de deux niveaux de performance : cible (100 %) et seuil de réussite (60 %).

Instructions détaillées
Lister au moins 10 savoir-faire.
Chaque savoir-faire doit commencer par un verbe à l’infinitif (ex. Mesurer, Calculer, Configurer, Vérifier, etc.).
Il doit représenter une action observable et évaluable.
Pour chaque savoir-faire, préciser :
Cible (niveau optimal, 100 %) : Formulée à l’infinitif, décrivant la maîtrise complète ou la performance idéale.
Seuil de réussite (niveau minimal, 60 %) : Aussi formulée à l’infinitif, décrivant la version minimale acceptable du même savoir-faire.
Éviter :
Les notions de quantité ou répétition (ex. « faire X fois »).
Les noms d’outils ou de technologies précises.
Exemple d’attendu
Savoir-faire : Analyser l’effet des réflexions sur une ligne de transmission

Cible (100 %) : Analyser avec précision les variations de signal en identifiant clairement l’origine des désadaptations.
Seuil (60 %) : Analyser les variations de manière suffisante pour repérer les principales anomalies et causes de désadaptation.
Savoir-faire : Mesurer l’impédance caractéristique d’un support

Cible (100 %) : Mesurer avec exactitude l’impédance en appliquant la bonne méthode et en interprétant correctement les résultats.
Seuil (60 %) : Mesurer l’impédance de base et reconnaître les écarts majeurs par rapport à la valeur attendue.
(jusqu’à avoir 10 savoir-faire minimum)

Comment adapter au présent cours
Transformer les actions en fonction du domaine (ex. Configurer un serveur Web, Concevoir une base de données, Effectuer une analyse de rentabilité, etc.).
Ajuster le langage et la précision selon le niveau visé (Bloom). Par exemple, Appliquer ou Mettre en œuvre pour un niveau intermédiaire, Concevoir ou Évaluer pour un niveau avancé.
Adapter les niveaux cible et seuil pour refléter les attendus concrets dans la pratique de votre discipline.

---

## Moyen d&#39;évaluation d&#39;une capacité
Trouve 3 ou 4 moyens d&#39;évaluations adaptés pour cette capacité.

# Remarques

- Respecter la logique explicite : lier savoirs, savoir-faire et évaluation à chaque capacité (ne pas globaliser).
- S’assurer que chaque tableau “capacités” contient systématiquement la triple structure : savoirs, savoir-faire, moyens d’évaluation.
- Reproduire fidèlement la langue et le degré de précision montré dans les exemples.
- Pour toutes les listes longues (ex : savoirs, savoir-faire), fournir la longueur requise (même si exemples ci-dessous sont abrégés).
- Pour les exemples, utiliser des placeholders réalistes : (ex : “Décrire les principes de base du [concept central du cours]”).

---

**Résumé importante** :  
Pour chaque capacité, générez immédiatement après son texte et sa pondération :
- La liste complète de ses savoirs nécessaires ;
- La liste complète de ses savoir-faire associés (avec cible et seuil) ;
- Les moyens d’évaluation pertinents pour cette capacité.

Générez les autres sections exactement comme décrit, sans ajout ni omission spontanée.

""",
  model="gpt-4.1-mini",
  output_type=RDacteurSchema,
  model_settings=_model_settings(
    temperature=1,
    top_p=1,
    store=True
  )
)


class GetDataFromWebContext:
  def __init__(self, state_infos_manquantes: str):
    self.state_infos_manquantes = state_infos_manquantes
def get_data_from_web_instructions(run_context: RunContextWrapper[GetDataFromWebContext], _agent: Agent[GetDataFromWebContext]):
  state_infos_manquantes = run_context.context.state_infos_manquantes
  return f"""Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre. 
Va chercher sur le web pour les informations manquantes.

Voici les informations manquantes:
 {state_infos_manquantes}

code_cours:
nom_cours:
programme:
fil_conducteur:
session:
cours_prealables: []       # Codes + titres
cours_requis: []           # (optionnel)
cours_reliés: []           # (optionnel)
heures_theorie:
heures_lab:
heures_maison:
competences_developpees: []   # Codes + titres
competences_atteintes: []     # Codes + titres
competence_nom:               # Pour la section Description des compétences développées
cours_developpant_une_meme_competence: [] # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours"""
get_data_from_web = Agent(
  name="Get data from web",
  instructions=get_data_from_web_instructions,
  model="gpt-5-mini",
  tools=[
    web_search_preview
  ],
  model_settings=_model_settings(
    store=True,
    reasoning=Reasoning(
      effort="medium",
      summary="auto"
    )
  )
)


class Triage2Context:
  def __init__(self, input_output_text: str):
    self.input_output_text = input_output_text
def triage_2_instructions(run_context: RunContextWrapper[Triage2Context], _agent: Agent[Triage2Context]):
  input_output_text = run_context.context.input_output_text
  return f"""Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont fournis :
code_cours: 
nom_cours: 
programme: 
fil_conducteur: 
session: 
cours_prealables: []       # Codes + titres cours_requis: []           # (optionnel) 
cours_reliés: []           # (optionnel) 
heures_theorie: 
heures_lab: 
heures_maison: 
competences_developpees: []   # Codes + titres 
competences_atteintes: []     # Codes + titres 
competence_nom:               # Pour la section Description des compétences développées cours_developpant_une_meme_competence: [] # Pour les activités pratiques 
Une idée générale de ce qui devrait se retrouver dans le cours.

Voici les informations connues {input_output_text}"""
triage_2 = Agent(
  name="Triage 2",
  instructions=triage_2_instructions,
  model="gpt-5",
  output_type=Triage2Schema,
  model_settings=_model_settings(
    store=True,
    reasoning=Reasoning(
      effort="minimal",
      summary="auto"
    )
  )
)


class GetDataFromUserContext:
  def __init__(self, state_infos_manquantes: str):
    self.state_infos_manquantes = state_infos_manquantes
def get_data_from_user_instructions(run_context: RunContextWrapper[GetDataFromUserContext], _agent: Agent[GetDataFromUserContext]):
  state_infos_manquantes = run_context.context.state_infos_manquantes
  return f"""Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre. 

Arrête-toi et demande à l'utilisateur les informations manquantes.
infos manquantes:
 {state_infos_manquantes}
"""
get_data_from_user = Agent(
  name="Get data from user",
  instructions=get_data_from_user_instructions,
  model="gpt-5-nano",
  model_settings=_model_settings(
    store=True,
    reasoning=Reasoning(
      effort="medium",
      summary="auto"
    )
  )
)


class WorkflowInput(BaseModel):
  input_as_text: str


@dataclass
class WorkflowStepSummary:
  key: str
  title: str
  output: str
  reasoning: Workflow | None = None
  reasoning_text: str = ""


@dataclass
class WorkflowRunSummary:
  steps: list[WorkflowStepSummary]
  final_output: dict[str, Any] | None


@dataclass
class WorkflowStepStreamUpdate:
  key: str
  title: str
  index: int
  delta: str
  text: str
  reasoning_delta: str = ""
  reasoning_text: str = ""


class WorkflowExecutionError(RuntimeError):
  def __init__(
    self,
    step: str,
    title: str,
    original_error: Exception,
    steps: list[WorkflowStepSummary],
  ) -> None:
    super().__init__(str(original_error))
    self.step = step
    self.title = title
    self.original_error = original_error
    self.steps = steps

  def __str__(self) -> str:
    return f"{self.title} ({self.step}) : {self.original_error}"


def _format_step_output(payload: Any) -> str:
  if payload is None:
    return "(aucune sortie)"

  if isinstance(payload, BaseModel):
    payload = payload.model_dump()

  if isinstance(payload, (dict, list)):
    try:
      return json.dumps(payload, ensure_ascii=False, indent=2)
    except TypeError:
      return str(payload)

  if isinstance(payload, str):
    text_value = payload.strip()
    if not text_value:
      return "(aucune sortie)"

    try:
      parsed = json.loads(text_value)
    except json.JSONDecodeError:
      return text_value

    if isinstance(parsed, (dict, list)):
      try:
        return json.dumps(parsed, ensure_ascii=False, indent=2)
      except TypeError:
        return str(parsed)
    return str(parsed)

  return str(payload)


_SECTION_HDR = re.compile(
  r"(?im)^(?:\*\*([^\*]{1,120})\*\*)$"
  r"|"
  r"^(?:#{1,6}\s*|\d+\.\s+|[-*]\s+)?\s*([A-ZÀ-ÖØ-Ýa-zà-öø-ÿ0-9][^\n]{0,120})\s*$"
)


def _extract_sections(text: str) -> list[tuple[str, str]]:
  lines = text.splitlines()
  sections: list[tuple[str, str]] = []
  cur_title: str | None = None
  cur_buf: list[str] = []

  def flush() -> None:
    nonlocal cur_title, cur_buf, sections
    if cur_title is not None:
      body = "\n".join(cur_buf).strip()
      sections.append((cur_title.strip() or "Résumé du raisonnement", body))
    cur_title, cur_buf = None, []

  for ln in lines:
    match = _SECTION_HDR.match(ln.strip())
    if match:
      title = match.group(1) or match.group(2) or "Résumé du raisonnement"
      title = title.strip().rstrip(": -")
      flush()
      cur_title = title
    else:
      cur_buf.append(ln)

  flush()
  if not sections:
    return [("Résumé du raisonnement", text.strip())]
  return sections


class _ReasoningWorkflowReporter:
  def __init__(self, agent_context: AgentContext | None) -> None:
    self._context = agent_context
    self._started = False
    self._ended = False
    self._display_tasks: list[SearchTask | ThoughtTask] = []
    self._reasoning_buffer = ""
    self._all_reasoning_segments: list[str] = []
    self._reasoning_task_start_index: int | None = None
    self._reasoning_sections: list[tuple[str, str]] = []
    self._search_tasks: dict[str, SearchTask] = {}
    self._search_task_indices: dict[str, int] = {}

  async def _ensure_started(self) -> None:
    if self._context is None or self._started or self._ended:
      return
    await self._context.start_workflow(Workflow(type="reasoning", tasks=[]))
    self._started = True

  def _is_context_ready(self) -> bool:
    return self._context is not None and not self._ended

  async def _recover_workflow_state(self) -> None:
    if not self._is_context_ready():
      return
    await self._context.start_workflow(
      Workflow(type="reasoning", tasks=list(self._display_tasks))
    )
    self._started = True

  async def _safe_update_task(self, task: SearchTask | ThoughtTask, index: int) -> None:
    if not self._is_context_ready():
      return
    await self._ensure_started()
    try:
      await self._context.update_workflow_task(task, task_index=index)
    except ValueError as exc:
      if "Workflow is not set" not in str(exc):
        raise
      await self._recover_workflow_state()
      await self._context.update_workflow_task(task, task_index=index)

  async def _safe_add_task(self, task: SearchTask | ThoughtTask, index: int) -> None:
    if not self._is_context_ready():
      return
    await self._ensure_started()
    try:
      await self._context.add_workflow_task(task)
    except ValueError as exc:
      if "Workflow is not set" not in str(exc):
        raise
      await self._recover_workflow_state()
    await self._safe_update_task(task, index)

  def _status_to_indicator(self, status: str | None) -> str:
    if not status:
      return "loading"
    normalized = status.lower()
    if normalized in {"completed", "failed"}:
      return "complete"
    return "loading"

  def _normalize_web_search_action(
    self,
    action: dict[str, Any] | None,
    *,
    fallback_title: str | None = None,
  ) -> tuple[str | None, list[str], list[URLSource]]:
    if not action:
      return fallback_title, [], []

    action_type = str(action.get("type") or "").lower()
    queries: list[str] = []
    primary_query: str | None = None
    sources: list[URLSource] = []

    def append_source(
      url: str | None,
      *,
      title: str | None = None,
      description: str | None = None,
      timestamp: str | None = None,
      group: str | None = None,
    ) -> None:
      if not url:
        return
      source_title = title or fallback_title or url
      try:
        sources.append(
          URLSource(
            url=url,
            title=source_title,
            description=description,
            timestamp=timestamp,
            group=group,
          )
        )
      except ValidationError:
        sources.append(URLSource(url=url, title=source_title))

    if action_type == "search":
      query = action.get("query")
      if isinstance(query, str) and query.strip():
        primary_query = query.strip()
        queries.append(primary_query)

      raw_sources = action.get("sources") or []
      if isinstance(raw_sources, list):
        for src in raw_sources:
          if not isinstance(src, dict):
            continue
          append_source(
            src.get("url"),
            title=src.get("title"),
            description=src.get("description"),
            timestamp=src.get("timestamp"),
            group=src.get("group"),
          )

    elif action_type == "open_page":
      url = action.get("url")
      title = action.get("title")
      append_source(url, title=title)
      if isinstance(url, str) and url:
        queries.append(f"Ouverture de {url}")

    elif action_type == "find":
      pattern = action.get("pattern")
      url = action.get("url")
      if isinstance(url, str) and url:
        append_source(url, title=action.get("title"))
      if isinstance(pattern, str) and pattern.strip():
        if isinstance(url, str) and url:
          queries.append(f"Recherche «{pattern.strip()}» dans {url}")
        else:
          queries.append(f"Recherche «{pattern.strip()}»")

    else:
      summary = action.get("summary")
      if isinstance(summary, str) and summary.strip():
        queries.append(summary.strip())

    if primary_query is None and queries:
      primary_query = queries[0]

    return primary_query, queries, sources

  async def update_web_search_task(self, call_data: dict[str, Any]) -> None:
    if self._context is None or self._ended:
      return

    call_id = str(call_data.get("id") or "").strip()
    if not call_id:
      return

    await self._ensure_started()

    status_raw = call_data.get("status")
    status = str(status_raw) if status_raw is not None else None
    action_data = call_data.get("action")
    if hasattr(action_data, "model_dump"):
      action_dict = action_data.model_dump(exclude_none=False)
    elif isinstance(action_data, dict):
      action_dict = dict(action_data)
    else:
      action_dict = {}

    fallback_title = call_data.get("label")
    if not isinstance(fallback_title, str):
      fallback_title = None

    primary_query, queries, sources = self._normalize_web_search_action(
      action_dict,
      fallback_title=fallback_title,
    )

    indicator = self._status_to_indicator(status)
    existing = self._search_tasks.get(call_id)
    created = False
    changed = False

    if existing is None:
      title_value = primary_query or fallback_title or "Recherche web"
      existing = SearchTask(
        status_indicator=indicator,
        title=title_value,
        title_query=primary_query,
        queries=[],
        sources=[],
      )
      self._search_tasks[call_id] = existing
      created = True
    else:
      if indicator and existing.status_indicator != indicator:
        existing.status_indicator = indicator
        changed = True
      if primary_query and existing.title_query != primary_query:
        existing.title_query = primary_query
        if not existing.title or existing.title == fallback_title or existing.title == "Recherche web":
          existing.title = primary_query
          changed = True
      if not existing.title and (primary_query or fallback_title):
        existing.title = primary_query or fallback_title
        changed = True

    current_queries = {q for q in existing.queries if isinstance(q, str)}
    for query in queries:
      if not isinstance(query, str):
        continue
      normalized = query.strip()
      if not normalized or normalized in current_queries:
        continue
      existing.queries.append(normalized)
      current_queries.add(normalized)
      changed = True

    current_urls = {getattr(src, "url", None) for src in existing.sources}
    for source in sources:
      url = getattr(source, "url", None)
      if not url or url in current_urls:
        continue
      existing.sources.append(source)
      current_urls.add(url)
      changed = True

    if created and indicator and existing.status_indicator != indicator:
      existing.status_indicator = indicator

    index = self._search_task_indices.get(call_id)
    if index is None:
      index = len(self._display_tasks)
      self._search_task_indices[call_id] = index
      self._display_tasks.append(existing)
      await self._safe_add_task(existing, index)
      return

    if index >= len(self._display_tasks):
      self._display_tasks.append(existing)
      await self._safe_add_task(existing, index)
      return

    self._display_tasks[index] = existing
    if changed:
      await self._safe_update_task(existing, index)

  async def _finalize_search_tasks(self) -> None:
    if not self._is_context_ready():
      return
    pending_updates: list[tuple[SearchTask, int]] = []
    for call_id, index in self._search_task_indices.items():
      if index >= len(self._display_tasks):
        continue
      task = self._display_tasks[index]
      if not isinstance(task, SearchTask):
        continue
      if task.status_indicator != "complete":
        task.status_indicator = "complete"
        pending_updates.append((task, index))

    for task, index in pending_updates:
      await self._safe_update_task(task, index)

  async def _update_reasoning_display(self, full_content: str) -> None:
    if not full_content or self._context is None or self._ended:
      return
    await self._ensure_started()

    sections = [
      (title, body)
      for title, body in _extract_sections(full_content)
      if body
    ]
    if not sections:
      sections = _extract_sections(full_content)

    if sections == self._reasoning_sections:
      return

    start_index = self._reasoning_task_start_index
    if start_index is None:
      start_index = len(self._display_tasks)
      self._reasoning_task_start_index = start_index

    previous_section_count = len(self._reasoning_sections)

    for offset, (title, body) in enumerate(sections):
      task_index = start_index + offset
      task = ThoughtTask(content=body or "")
      if hasattr(task, "title"):
        task.title = title or "Résumé du raisonnement"

      if task_index >= len(self._display_tasks):
        self._display_tasks.append(task)
        await self._safe_add_task(task, task_index)
      else:
        self._display_tasks[task_index] = task
        await self._safe_update_task(task, task_index)

    if previous_section_count > len(sections):
      for offset in range(len(sections), previous_section_count):
        task_index = start_index + offset
        if task_index >= len(self._display_tasks):
          break
        placeholder = ThoughtTask(content="")
        if hasattr(placeholder, "title"):
          placeholder.title = ""
        self._display_tasks[task_index] = placeholder
        await self._safe_update_task(placeholder, task_index)

    self._reasoning_sections = sections

  async def append_reasoning(self, delta: str) -> None:
    if self._context is None or self._ended:
      return
    if not delta:
      return
    await self._ensure_started()
    self._reasoning_buffer += delta
    raw_segments = self._reasoning_buffer.split("\n\n")
    normalized_segments = [
      segment.strip()
      for segment in raw_segments
      if segment.strip()
    ]

    self._all_reasoning_segments = list(normalized_segments)

    full_content = "\n\n".join(normalized_segments)
    self._reasoning_buffer = full_content
    await self._update_reasoning_display(full_content)

  async def sync_reasoning_summary(self, segments: list[str]) -> None:
    if self._context is None or self._ended:
      return
    normalized_segments = [
      segment.strip()
      for segment in segments
      if segment and segment.strip()
    ]
    self._all_reasoning_segments = list(normalized_segments)
    full_content = "\n\n".join(normalized_segments)
    self._reasoning_buffer = full_content
    await self._update_reasoning_display(full_content)

  async def finish(self, *, error: BaseException | None = None) -> None:
    if self._context is None or self._ended:
      return

    if not self._started:
      self._ended = True
      return

    try:
      try:
        await self._finalize_search_tasks()
        await self._context.end_workflow()
      except ValueError as exc:
        if "Workflow is not set" not in str(exc):
          raise
        await self._recover_workflow_state()
        await self._finalize_search_tasks()
        await self._context.end_workflow()
    except Exception as exc:
      if error is None:
        raise
    finally:
      self._ended = True


# Main code entrypoint
async def run_workflow(
  workflow_input: WorkflowInput,
  on_step: Callable[[WorkflowStepSummary, int], Awaitable[None]] | None = None,
  on_step_stream: Callable[[WorkflowStepStreamUpdate], Awaitable[None]] | None = None,
  agent_context: AgentContext | None = None,
) -> WorkflowRunSummary:
  state = {
    "has_all_details": False,
    "infos_manquantes": None
  }
  steps: list[WorkflowStepSummary] = []
  workflow = workflow_input.model_dump()
  conversation_history: list[TResponseInputItem] = [
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": workflow["input_as_text"]
        }
      ]
    }
  ]

  def _workflow_run_config() -> RunConfig:
    return RunConfig(trace_metadata={
      "__trace_source__": "agent-builder",
      "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae"
    })

  async def record_step(
    step_key: str,
    title: str,
    payload: Any,
    *,
    reasoning_summary: Workflow | None = None,
    reasoning_text: str = "",
  ) -> None:
    summary = WorkflowStepSummary(
      key=step_key,
      title=title,
      output=_format_step_output(payload),
      reasoning=reasoning_summary,
      reasoning_text=reasoning_text.strip(),
    )
    steps.append(summary)
    if on_step is not None:
      await on_step(summary, len(steps))

  def raise_step_error(step_key: str, title: str, error: Exception) -> None:
    raise WorkflowExecutionError(step_key, title, error, list(steps)) from error

  def _structured_output_as_json(output: Any) -> tuple[Any, str]:
    if hasattr(output, "model_dump"):
      parsed = output.model_dump()
      return parsed, json.dumps(parsed, ensure_ascii=False)
    if isinstance(output, (dict, list)):
      return output, json.dumps(output, ensure_ascii=False)
    return output, str(output)

  @dataclass
  class _AgentStepResult:
    stream: Any
    reasoning_text: str = ""
    reasoning_summary: Workflow | None = None

  async def run_agent_step(
    step_key: str,
    title: str,
    agent: Agent,
    *,
    context: Any | None = None,
    agent_context: AgentContext | None = None,
  ) -> _AgentStepResult:
    step_index = len(steps) + 1
    streaming_result = Runner.run_streamed(
      agent,
      input=[*conversation_history],
      run_config=_workflow_run_config(),
      context=context,
    )
    accumulated_text = ""
    reasoning_accumulated = ""
    last_reasoning_summary_segments: list[str] = []
    reporter = _ReasoningWorkflowReporter(agent_context)

    async def _emit_stream_update(
      *,
      delta: str = "",
      reasoning_delta: str = "",
    ) -> None:
      if on_step_stream is None:
        return
      await on_step_stream(
        WorkflowStepStreamUpdate(
          key=step_key,
          title=title,
          index=step_index,
          delta=delta,
          text=accumulated_text,
          reasoning_delta=reasoning_delta,
          reasoning_text=reasoning_accumulated,
        )
      )

    try:
      async for event in streaming_result.stream_events():
        if isinstance(event, AgentUpdatedStreamEvent):
          continue

        if not isinstance(event, RunItemStreamEvent):
          continue

        item = getattr(event, "item", None)
        if item is None:
          continue

        event_name = getattr(event, "name", "")
        item_type = getattr(item, "type", "")

        if event_name == "tool_called":
          raw_item = getattr(item, "raw_item", None)
          is_web_search = isinstance(raw_item, ResponseFunctionWebSearch) or (
            getattr(raw_item, "type", "") == "web_search_call"
          )
          if is_web_search:
            if hasattr(raw_item, "model_dump"):
              call_data = raw_item.model_dump(exclude_none=False)
            elif isinstance(raw_item, dict):
              call_data = dict(raw_item)
            else:
              call_data = {}
            if call_data:
              await reporter.update_web_search_task(call_data)
          continue

        if event_name == "tool_output":
          # Aucun traitement spécifique n'est requis pour l'instant, mais on pourra
          # compléter ici si l'affichage des outils doit être synchronisé.
          continue

        if event_name in {"handoff_requested", "handoff_occured"}:
          continue

        if event_name == "message_output_created" and item_type == "message_output_item":
          full_text = ItemHelpers.text_message_output(item) or ""
          if not full_text:
            continue

          if full_text.startswith(accumulated_text):
            delta_text = full_text[len(accumulated_text):]
          else:
            delta_text = full_text

          if not delta_text:
            accumulated_text = full_text
            continue

          accumulated_text = full_text
          await _emit_stream_update(delta=delta_text)
          continue

        if event_name == "reasoning_item_created" and item_type == "reasoning_item":
          raw_item = getattr(item, "raw_item", None)
          summary_items = getattr(raw_item, "summary", None) or []

          summary_segments = [
            getattr(segment, "text", "").strip()
            for segment in summary_items
            if getattr(segment, "text", "").strip()
          ]

          if not summary_segments:
            continue

          combined_summary = "\n\n".join(summary_segments)
          if not combined_summary:
            continue

          if combined_summary.startswith(reasoning_accumulated):
            reasoning_delta = combined_summary[len(reasoning_accumulated):]
            if reasoning_delta:
              await reporter.append_reasoning(reasoning_delta)
          else:
            reasoning_delta = combined_summary

          reasoning_accumulated = combined_summary
          last_reasoning_summary_segments = list(summary_segments)
          await reporter.sync_reasoning_summary(summary_segments)

          if reasoning_delta:
            await _emit_stream_update(reasoning_delta=reasoning_delta)
          continue

    except Exception as exc:
      await reporter.finish(error=exc)
      raise_step_error(step_key, title, exc)

    conversation_history.extend([
      item.to_input_item() for item in streaming_result.new_items
    ])

    summary_segments = last_reasoning_summary_segments
    normalized_summary = [
      segment.strip()
      for segment in summary_segments
      if segment and segment.strip()
    ]
    if normalized_summary:
      await reporter.sync_reasoning_summary(normalized_summary)
      reasoning_accumulated = "\n\n".join(normalized_summary)

    await reporter.finish()
    return _AgentStepResult(
      stream=streaming_result,
      reasoning_text=reasoning_accumulated.strip(),
    )

  triage_title = "Analyse des informations fournies"
  triage_run = await run_agent_step(
    "triage",
    triage_title,
    triage,
    agent_context=agent_context,
  )
  triage_parsed, triage_text = _structured_output_as_json(triage_run.stream.final_output)
  triage_result = {
    "output_text": triage_text,
    "output_parsed": triage_parsed
  }
  if isinstance(triage_parsed, dict):
    state["has_all_details"] = bool(triage_parsed.get("has_all_details"))
  else:
    state["has_all_details"] = False
  state["infos_manquantes"] = triage_result["output_text"]
  await record_step(
    "triage",
    triage_title,
    triage_result["output_parsed"],
    reasoning_summary=triage_run.reasoning_summary,
    reasoning_text=triage_run.reasoning_text,
  )

  if state["has_all_details"] is True:
    redacteur_title = "Rédaction du plan-cadre"
    r_dacteur_run = await run_agent_step(
      "r_dacteur",
      redacteur_title,
      r_dacteur,
      agent_context=agent_context,
    )
    redacteur_parsed, redacteur_text = _structured_output_as_json(
      r_dacteur_run.stream.final_output
    )
    r_dacteur_result = {
      "output_text": redacteur_text,
      "output_parsed": redacteur_parsed
    }
    await record_step(
      "r_dacteur",
      redacteur_title,
      r_dacteur_result["output_text"],
      reasoning_summary=r_dacteur_run.reasoning_summary,
      reasoning_text=r_dacteur_run.reasoning_text,
    )
    return WorkflowRunSummary(steps=steps, final_output=r_dacteur_result)

  web_step_title = "Collecte d'exemples externes"
  get_data_from_web_run = await run_agent_step(
    "get_data_from_web",
    web_step_title,
    get_data_from_web,
    context=GetDataFromWebContext(state_infos_manquantes=state["infos_manquantes"]),
    agent_context=agent_context,
  )
  get_data_from_web_result = {
    "output_text": get_data_from_web_run.stream.final_output_as(str)
  }
  await record_step(
    "get_data_from_web",
    web_step_title,
    get_data_from_web_result["output_text"],
    reasoning_summary=get_data_from_web_run.reasoning_summary,
    reasoning_text=get_data_from_web_run.reasoning_text,
  )

  triage_2_title = "Validation après collecte"
  triage_2_run = await run_agent_step(
    "triage_2",
    triage_2_title,
    triage_2,
    context=Triage2Context(input_output_text=get_data_from_web_result["output_text"]),
    agent_context=agent_context,
  )
  triage_2_parsed, triage_2_text = _structured_output_as_json(
    triage_2_run.stream.final_output
  )
  triage_2_result = {
    "output_text": triage_2_text,
    "output_parsed": triage_2_parsed
  }
  if isinstance(triage_2_parsed, dict):
    state["has_all_details"] = bool(triage_2_parsed.get("has_all_details"))
  else:
    state["has_all_details"] = False
  state["infos_manquantes"] = triage_2_result["output_text"]
  await record_step(
    "triage_2",
    triage_2_title,
    triage_2_result["output_parsed"],
    reasoning_summary=triage_2_run.reasoning_summary,
    reasoning_text=triage_2_run.reasoning_text,
  )

  if state["has_all_details"] is True:
    redacteur_title = "Rédaction du plan-cadre"
    r_dacteur_run = await run_agent_step(
      "r_dacteur",
      redacteur_title,
      r_dacteur,
      agent_context=agent_context,
    )
    redacteur_parsed, redacteur_text = _structured_output_as_json(
      r_dacteur_run.stream.final_output
    )
    r_dacteur_result = {
      "output_text": redacteur_text,
      "output_parsed": redacteur_parsed
    }
    await record_step(
      "r_dacteur",
      redacteur_title,
      r_dacteur_result["output_text"],
      reasoning_summary=r_dacteur_run.reasoning_summary,
      reasoning_text=r_dacteur_run.reasoning_text,
    )
    return WorkflowRunSummary(steps=steps, final_output=r_dacteur_result)

  user_step_title = "Demande d'informations supplémentaires"
  get_data_from_user_run = await run_agent_step(
    "get_data_from_user",
    user_step_title,
    get_data_from_user,
    context=GetDataFromUserContext(state_infos_manquantes=state["infos_manquantes"]),
    agent_context=agent_context,
  )
  get_data_from_user_result = {
    "output_text": get_data_from_user_run.stream.final_output_as(str)
  }
  await record_step(
    "get_data_from_user",
    user_step_title,
    get_data_from_user_result["output_text"],
    reasoning_summary=get_data_from_user_run.reasoning_summary,
    reasoning_text=get_data_from_user_run.reasoning_text,
  )

  redacteur_title = "Rédaction du plan-cadre"
  r_dacteur_run = await run_agent_step(
    "r_dacteur",
    redacteur_title,
    r_dacteur,
    agent_context=agent_context,
  )
  redacteur_parsed, redacteur_text = _structured_output_as_json(
    r_dacteur_run.stream.final_output
  )
  r_dacteur_result = {
    "output_text": redacteur_text,
    "output_parsed": redacteur_parsed
  }
  await record_step(
    "r_dacteur",
    redacteur_title,
    r_dacteur_result["output_text"],
    reasoning_summary=r_dacteur_run.reasoning_summary,
    reasoning_text=r_dacteur_run.reasoning_text,
  )
  return WorkflowRunSummary(steps=steps, final_output=r_dacteur_result)
