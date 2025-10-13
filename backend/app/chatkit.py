from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from types import MethodType
from typing import Any, AsyncIterator, Awaitable, Callable, Coroutine, Sequence

from agents import (
    Agent,
    ModelSettings,
    RunConfig,
    RunContextWrapper,
    Runner,
    TResponseInputItem,
    WebSearchTool,
)
from agents.items import ToolCallItem, ToolCallOutputItem
from agents.run import RunResultStreaming
from agents.stream_events import RunItemStreamEvent
from openai.types.shared.reasoning import Reasoning
from pydantic import BaseModel

from chatkit.agents import AgentContext, stream_agent_response, _merge_generators
from chatkit.server import ChatKitServer
from chatkit.store import NotFoundError
from chatkit.types import (
    AssistantMessageContentPartTextDelta,
    ClientToolCallItem,
    EndOfTurnItem,
    ErrorCode,
    ErrorEvent,
    ProgressUpdateEvent,
    ThreadItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadStreamEvent,
    UserMessageItem,
)

from .token_sanitizer import sanitize_model_like
from .config import Settings, get_settings
from .chatkit_store import PostgresChatKitStore
from .database import SessionLocal

logger = logging.getLogger("chatkit.server")


@dataclass(frozen=True)
class ChatKitRequestContext:
    """Contexte minimal passé au serveur ChatKit pour loguer l'utilisateur."""

    user_id: str | None
    email: str | None
    authorization: str | None = None

    def trace_metadata(self) -> dict[str, str]:
        """Retourne des métadonnées de trace compatibles avec l'Agents SDK."""
        metadata: dict[str, str] = {}
        if self.user_id:
            metadata["user_id"] = self.user_id
        if self.email:
            metadata["user_email"] = self.email
        return metadata


class DemoChatKitServer(ChatKitServer[ChatKitRequestContext]):
    """Serveur ChatKit piloté par un workflow local."""

    def __init__(self, settings: Settings) -> None:
        super().__init__(PostgresChatKitStore(SessionLocal))
        self._settings = settings

    async def respond(
        self,
        thread: ThreadMetadata,
        input_user_message: UserMessageItem | None,
        context: ChatKitRequestContext,
    ) -> AsyncIterator[ThreadStreamEvent]:
        try:
            history = await self.store.load_thread_items(
                thread.id,
                after=None,
                limit=1000,
                order="asc",
                context=context,
            )
        except NotFoundError as exc:  # Should not happen in normal flow
            logger.exception("Unable to load thread %s", thread.id, exc_info=exc)
            yield ErrorEvent(
                code=ErrorCode.STREAM_ERROR,
                message=f"Thread introuvable : {thread.id}",
                allow_retry=False,
            )
            return

        user_text = _resolve_user_input_text(input_user_message, history.data)
        if not user_text:
            yield ErrorEvent(
                code=ErrorCode.STREAM_ERROR,
                message="Impossible de déterminer le message utilisateur à traiter.",
                allow_retry=False,
            )
            return

        agent_context = AgentContext(
            thread=thread,
            store=self.store,
            request_context=context,
        )

        event_queue: asyncio.Queue[Any] = asyncio.Queue()

        workflow_result = _WorkflowStreamResult(
            runner=self._execute_workflow(
                thread=thread,
                agent_context=agent_context,
                workflow_input=WorkflowInput(input_as_text=user_text),
                event_queue=event_queue,
            ),
            event_queue=event_queue,
        )

        try:
            async for event in workflow_result.stream_events():
                yield event
        except asyncio.CancelledError:  # pragma: no cover - déconnexion client
            logger.info(
                "Streaming interrompu pour le fil %s, poursuite du workflow en tâche de fond",
                thread.id,
            )
            return

    async def _execute_workflow(
        self,
        *,
        thread: ThreadMetadata,
        agent_context: AgentContext[ChatKitRequestContext],
        workflow_input: WorkflowInput,
        event_queue: asyncio.Queue[Any],
    ) -> None:
        streamed_step_keys: set[str] = set()
        step_progress_text: dict[str, str] = {}

        try:
            logger.info("Démarrage du workflow pour le fil %s", thread.id)

            async def on_step(
                step_summary: WorkflowStepSummary, index: int
            ) -> None:
                streamed_step_keys.add(step_summary.key)
                step_progress_text.pop(step_summary.key, None)

            async def on_stream_event(event: ThreadStreamEvent) -> None:
                await event_queue.put(event)

            async def on_step_stream(
                update: WorkflowStepStreamUpdate,
            ) -> None:
                header = f"Étape {update.index} – {update.title}"

                if update.key not in step_progress_text:
                    waiting_text = f"{header}\n\nGénération en cours..."
                    step_progress_text[update.key] = waiting_text
                    await on_stream_event(ProgressUpdateEvent(text=waiting_text))

                aggregated_text = update.text
                if not aggregated_text.strip():
                    return

                progress_text = f"{header}\n\n{aggregated_text}"
                if step_progress_text.get(update.key) == progress_text:
                    return

                step_progress_text[update.key] = progress_text
                await on_stream_event(ProgressUpdateEvent(text=progress_text))

            await run_workflow(
                workflow_input,
                agent_context=agent_context,
                on_step=on_step,
                on_step_stream=on_step_stream,
                on_stream_event=on_stream_event,
            )

            await on_stream_event(
                EndOfTurnItem(
                    id=self.store.generate_item_id(
                        "message", thread, agent_context.request_context
                    ),
                    thread_id=thread.id,
                    created_at=datetime.now(),
                )
            )
            logger.info("Workflow terminé avec succès pour le fil %s", thread.id)
        except WorkflowExecutionError as exc:  # pragma: no cover - erreurs connues du workflow
            logger.exception("Workflow execution failed")
            error_message = (
                f"Le workflow a échoué pendant l'étape « {exc.title} » ({exc.step}). "
                f"Détails techniques : {exc.original_error}"
            )
            await on_stream_event(
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=error_message,
                    allow_retry=True,
                )
            )
            logger.info(
                "Workflow en erreur pour le fil %s pendant %s", thread.id, exc.step
            )
        except Exception as exc:  # pragma: no cover - autres erreurs runtime
            logger.exception("Workflow execution failed")
            detailed_message = f"Erreur inattendue ({exc.__class__.__name__}) : {exc}"
            await on_stream_event(
                ErrorEvent(
                    code=ErrorCode.STREAM_ERROR,
                    message=detailed_message,
                    allow_retry=True,
                )
            )
            logger.info(
                "Workflow en erreur inattendue pour le fil %s", thread.id
            )
        finally:
            event_queue.put_nowait(_STREAM_DONE)


def _collect_user_text(message: UserMessageItem | None) -> str:
    """Concatène le texte d'un message utilisateur."""
    if not message or not getattr(message, "content", None):
        return ""
    parts: list[str] = []
    for content_item in message.content:
        text = getattr(content_item, "text", None)
        if text:
            parts.append(text)
    return "\n".join(part.strip() for part in parts if part.strip())


def _resolve_user_input_text(
    input_user_message: UserMessageItem | None,
    history: Sequence[ThreadItem],
) -> str:
    """Détermine le texte du message utilisateur à traiter."""
    candidate = _collect_user_text(input_user_message)
    if candidate:
        return candidate

    for item in reversed(history):
        if isinstance(item, UserMessageItem):
            candidate = _collect_user_text(item)
            if candidate:
                return candidate

    return ""


def _log_background_exceptions(task: asyncio.Task[None]) -> None:
    try:
        exception = task.exception()
    except asyncio.CancelledError:  # pragma: no cover - annulation explicite
        logger.info("Traitement du workflow annulé")
        return
    except Exception:  # pragma: no cover - erreur lors de l'inspection
        logger.exception("Erreur lors de la récupération de l'exception de la tâche")
        return

    if exception:
        logger.exception("Erreur dans la tâche de workflow", exc_info=exception)


_STREAM_DONE = object()


class _WorkflowStreamResult:
    """Adaptateur minimal pour exposer les événements du workflow."""

    def __init__(
        self,
        *,
        runner: Coroutine[Any, Any, None],
        event_queue: asyncio.Queue[Any],
    ) -> None:
        self._event_queue = event_queue
        self._task = asyncio.create_task(runner)
        self._task.add_done_callback(_log_background_exceptions)

    async def stream_events(self) -> AsyncIterator[Any]:
        while True:
            event = await self._event_queue.get()
            if event is _STREAM_DONE:
                break
            yield event

        await self._task


# ---------------------------------------------------------------------------
# Adaptateur de streaming des réponses Agents avec interception des outils
# ---------------------------------------------------------------------------


async def stream_agent_response_with_tools(
    context: AgentContext, result: RunResultStreaming
) -> AsyncIterator[ThreadStreamEvent]:
    """Relaye les événements Agents en exposant explicitement les appels d'outils.

    Cette variante enrichit les événements retournés par
    :func:`chatkit.agents.stream_agent_response` en injectant des
    ``ClientToolCallItem`` lorsque l'agent déclenche un outil (événements
    ``tool_call_item`` / ``tool_call_output_item``). Les appels d'outils sont
    diffusés comme un élément client en trois temps : ajout (`pending`), mise à
    jour (`completed` + sortie) puis finalisation.
    """

    tool_event_queue: asyncio.Queue[ThreadStreamEvent | object] = asyncio.Queue()
    queue_done = object()
    pending_calls: dict[str, ClientToolCallItem] = {}
    call_ids_by_item_id: dict[str, str] = {}

    def _generate_tool_call_id() -> str:
        return context.store.generate_item_id(
            "tool_call", context.thread, context.request_context
        )

    def _resolve_call_id(candidate: str | None) -> str:
        if candidate:
            return str(candidate)
        return _generate_tool_call_id()

    def _resolve_item_id(raw_id: str | None, call_id: str) -> str:
        if raw_id:
            return str(raw_id)
        return call_id or _generate_tool_call_id()

    def _resolve_tool_name(raw_item: Any) -> str:
        name = getattr(raw_item, "name", None)
        if name:
            return str(name)
        raw_type = getattr(raw_item, "type", None)
        if raw_type == "web_search_call":
            return "web_search"
        if raw_type:
            return str(raw_type)
        return "tool_call"

    def _normalize_payload(value: Any) -> Any:
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                return value
            else:
                return parsed
        if hasattr(value, "model_dump"):
            return value.model_dump()
        if isinstance(value, bytes):
            try:
                return value.decode("utf-8")
            except UnicodeDecodeError:
                return value
        return value

    def _extract_arguments(raw_item: Any) -> dict[str, Any]:
        arguments = getattr(raw_item, "arguments", None)
        if arguments is None and hasattr(raw_item, "action"):
            arguments = getattr(raw_item, "action")
        normalized = _normalize_payload(arguments)
        if isinstance(normalized, dict):
            return normalized
        if normalized is None:
            return {}
        return {"value": normalized}

    def _emit_update_event(item: ClientToolCallItem) -> ThreadItemUpdated:
        update_payload = {
            "type": "client_tool_call.updated",
            "status": item.status,
            "output": item.output,
            "name": item.name,
            "arguments": item.arguments,
            "call_id": item.call_id,
        }
        return ThreadItemUpdated.model_construct(
            type="thread.item.updated", item_id=item.id, update=update_payload
        )

    async def _handle_tool_call(run_item: ToolCallItem) -> None:
        raw_item = run_item.raw_item
        call_id = _resolve_call_id(getattr(raw_item, "call_id", None))
        item_id = _resolve_item_id(getattr(raw_item, "id", None), call_id)
        call_ids_by_item_id[item_id] = call_id
        arguments = _extract_arguments(raw_item)
        client_tool = ClientToolCallItem(
            id=item_id,
            thread_id=context.thread.id,
            created_at=datetime.now(),
            call_id=call_id,
            name=_resolve_tool_name(raw_item),
            arguments=arguments,
            status="pending",
        )
        pending_calls[call_id] = client_tool
        await tool_event_queue.put(ThreadItemAddedEvent(item=client_tool))

    async def _handle_tool_output(run_item: ToolCallOutputItem) -> None:
        raw_item = run_item.raw_item
        call_id = getattr(raw_item, "call_id", None)
        if not call_id:
            raw_identifier = getattr(raw_item, "id", None)
            call_id = call_ids_by_item_id.get(str(raw_identifier)) if raw_identifier else None
        call_id = _resolve_call_id(call_id)
        existing = pending_calls.get(call_id)
        if existing is None:
            item_id = _resolve_item_id(getattr(raw_item, "id", None), call_id)
            existing = ClientToolCallItem(
                id=item_id,
                thread_id=context.thread.id,
                created_at=datetime.now(),
                call_id=call_id,
                name=_resolve_tool_name(raw_item),
                arguments=_extract_arguments(raw_item),
                status="pending",
            )
            call_ids_by_item_id[item_id] = call_id
            pending_calls[call_id] = existing
            await tool_event_queue.put(ThreadItemAddedEvent(item=existing))
        output_value = _normalize_payload(run_item.output)
        completed = existing.model_copy(
            update={"status": "completed", "output": output_value}
        )
        pending_calls[call_id] = completed
        await tool_event_queue.put(_emit_update_event(completed))
        await tool_event_queue.put(ThreadItemDoneEvent(item=completed))
        pending_calls.pop(call_id, None)

    async def _handle_run_item_event(event: RunItemStreamEvent) -> None:
        item = event.item
        if isinstance(item, ToolCallItem):
            await _handle_tool_call(item)
        elif isinstance(item, ToolCallOutputItem):
            await _handle_tool_output(item)

    original_stream_events = result.stream_events

    async def _hooked_stream_events(self) -> AsyncIterator[Any]:
        try:
            async for raw_event in original_stream_events():
                if isinstance(raw_event, RunItemStreamEvent):
                    await _handle_run_item_event(raw_event)
                yield raw_event
        finally:
            await tool_event_queue.put(queue_done)

    result.stream_events = MethodType(_hooked_stream_events, result)

    async def _tool_event_iterator() -> AsyncIterator[ThreadStreamEvent]:
        while True:
            queued = await tool_event_queue.get()
            if queued is queue_done:
                break
            yield queued

    try:
        base_stream = stream_agent_response(context, result)
        async for event in _merge_generators(base_stream, _tool_event_iterator()):
            yield event
    finally:
        result.stream_events = original_stream_events


# ---------------------------------------------------------------------------
# Définition du workflow local exécuté par DemoChatKitServer
# ---------------------------------------------------------------------------


class TriageSchema(BaseModel):
    has_all_details: bool
    details_manquants: str


class RDacteurSchemaIntroPlaceCours(BaseModel):
    texte: str


class RDacteurSchemaObjectifTerminal(BaseModel):
    texte: str


class RDacteurSchemaStructureIntro(BaseModel):
    texte: str


class RDacteurSchemaActivitesTheoriques(BaseModel):
    texte: str


class RDacteurSchemaActivitesPratiques(BaseModel):
    texte: str


class RDacteurSchemaActivitesPrevuesItem(BaseModel):
    phase: str
    description: str


class RDacteurSchemaEvaluationSommative(BaseModel):
    texte: str


class RDacteurSchemaNatureEvaluationsSommatives(BaseModel):
    texte: str


class RDacteurSchemaEvaluationLangue(BaseModel):
    texte: str


class RDacteurSchemaEvaluationFormative(BaseModel):
    texte: str


class RDacteurSchemaCompetencesDeveloppeesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCompetencesCertifieesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursCorequisItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaObjetsCiblesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursReliesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaCoursPrealablesItem(BaseModel):
    texte: str
    description: str


class RDacteurSchemaSavoirsFaireCapaciteItem(BaseModel):
    savoir_faire: str
    cible_100: str
    seuil_60: str


class RDacteurSchemaCapaciteItem(BaseModel):
    capacite: str
    pond_min: float
    pond_max: float
    savoirs_necessaires_capacite: list[str]
    savoirs_faire_capacite: list[RDacteurSchemaSavoirsFaireCapaciteItem]
    moyens_evaluation_capacite: list[str]


class RDacteurSchema(BaseModel):
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
    has_all_details: bool
    details_manquants: str


def _model_settings(**kwargs: Any) -> ModelSettings:
    return sanitize_model_like(ModelSettings(**kwargs))


web_search_preview = WebSearchTool(
    search_context_size="medium",
    user_location={
        "city": "Québec",
        "country": "CA",
        "region": "QC",
        "type": "approximate",
    },
)


triage = Agent(
    name="Triage",
    instructions=(
        """Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.
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
Une idée générale de ce qui devrait se retrouver dans le cours."""
    ),
    model="gpt-5",
    output_type=TriageSchema,
    model_settings=_model_settings(
        store=True,
        reasoning=Reasoning(
            effort="minimal",
            summary="auto",
        ),
    ),
)


r_dacteur = Agent(
    name="Rédacteur",
    instructions=(
        """Tu es un assistant pédagogique qui génère, en français, des contenus de plan-cadre selon le ton institutionnel : clairs, concis, rigoureux, rédigés au vouvoiement. Tu ne t’appuies que sur les informations fournies dans le prompt utilisateur, sans inventer de contenu. Si une information manque et qu’aucune directive de repli n’est donnée, omets l’élément manquant.

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

"Le cours «243-4Q4 – Communication radio» s’inscrit dans le fil conducteur «Sans-fil et fibre optique» du programme de Technologie du génie électrique : Réseaux et télécommunications et se donne en session 4. Afin de bien réussir ce cours, il est essentiel de maîtriser les connaissances préalables acquises dans «nom du cours», particulièrement [connaissances et compétences]. Ces acquis permettront aux personnes étudiantes de saisir plus aisément les notions [ de ... ]abordées dans le présent cours."

---

## Objectif terminal
Écrire un objectif terminal pour le cours {{nom_cours}} qui devrait commencer par: "Au terme de ce cours, les personnes étudiantes seront capables de" et qui termine par un objectif terminal qui correspond aux compétences à développer ou atteinte({{competences_developpees}}{{competences_atteintes}}). Celui-ci devrait clair, mais ne comprendre que 2 ou 3 actes. Le e nom du cours donne de bonnes explications sur les technologies utilisés dans le cours, à intégrer dans l'objectif terminal.

---

## Introduction Structure du Cours
Le cours «{{nom_cours}}» prévoit {{heures_theorie}} heures de théorie, {{heures_lab}} heures d’application en travaux pratiques ou en laboratoire et {{heures_maison}} heures de travail personnel sur une base hebdomadaire.

---

## Activités Théoriques
Écrire un texte sous cette forme adapté à la nature du cours ({{nom_cours}}), celui-ci devrait être similaire en longueur et en style:

"Les séances théoriques du cours visent à préparer les personnes étudiantes en vue de la mise en pratique de leurs connaissances au laboratoire. Ces séances seront axées sur plusieurs aspects, notamment les éléments constitutifs des systèmes électroniques analogiques utilisés en télécommunications. Les personnes étudiantes auront l'opportunité d'approfondir leur compréhension par le biais de discussions interactives, des exercices et des analyses de cas liés à l’installation et au fonctionnement des systèmes électroniques analogiques. "

---

## Activités Pratiques
Écrire un texte sous cette forme adapté à la nature du cours {{nom_cours}}, celui-ci devrait être similaire en longueur et en style.  Le premier chiffre après 243 indique la session sur 6 et le nom du cours donne de bonnes explications sur le matériel ou la technologie utilisé dans le cours

Voici les cours reliés:
{{cours_developpant_une_meme_competence}}

Voici un exemple provenant d'un autre cours de mes attentes:
"La structure des activités pratiques sur les 15 semaines du cours se déroulera de manière progressive et devrait se dérouler en 4 phases. La première phrase devrait s’inspirer du quotidien des personnes étudiantes qui, généralement, ont simplement utilisé des systèmes électroniques. Son objectif serait donc de favoriser la compréhension des composants essentiels des systèmes électroniques analogiques. Cela devrait conduire à une compréhension d’un système d’alimentation basé sur des panneaux solaires photovoltaïques, offrant ainsi une introduction pertinente aux systèmes d’alimentation en courant continu, utilisés dans les télécommunications. La seconde phase devrait mener l’a personne à comprendre la nature des signaux alternatifs dans le cadre de systèmes d’alimentation en courant alternatif et sur des signaux audios. La troisième phase viserait une exploration des systèmes de communication radio. Finalement, la dernière phase viserait à réaliser un projet final combinant les apprentissages réalisés, en partenariat avec les cours 243-1N5-LI - Systèmes numériques et 243-1P4-LI – Travaux d’atelier."

---

## Activités Prévues
Décrire les différentes phases de manière succincte en utilisant cette forme. Ne pas oublier que la session dure 15 semaines.

**Phase X - titre de la phase (Semaines Y à 4Z)**
  - Description de la phase

---

## Évaluation Sommative des Apprentissages
Pour la réussite du cours, la personne étudiante doit obtenir la note de 60% lorsque l'on fait la somme pondérée des capacités.

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

...
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

## Savoirs faire d'une capacité
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

## Moyen d'évaluation d'une capacité
Trouve 3 ou 4 moyens d'évaluations adaptés pour cette capacité.

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
"""
    ),
    model="gpt-4.1-mini",
    output_type=RDacteurSchema,
    model_settings=_model_settings(
        temperature=1,
        top_p=1,
        store=True,
    ),
)


class GetDataFromWebContext:
    def __init__(self, state_infos_manquantes: str) -> None:
        self.state_infos_manquantes = state_infos_manquantes


def get_data_from_web_instructions(
    run_context: RunContextWrapper[GetDataFromWebContext],
    _agent: Agent[GetDataFromWebContext],
) -> str:
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
    tools=[web_search_preview],
    model_settings=_model_settings(
        store=True,
        reasoning=Reasoning(
            effort="medium",
            summary="auto",
        ),
    ),
)


class Triage2Context:
    def __init__(self, input_output_text: str) -> None:
        self.input_output_text = input_output_text


def triage_2_instructions(
    run_context: RunContextWrapper[Triage2Context],
    _agent: Agent[Triage2Context],
) -> str:
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
            summary="auto",
        ),
    ),
)


class GetDataFromUserContext:
    def __init__(self, state_infos_manquantes: str) -> None:
        self.state_infos_manquantes = state_infos_manquantes


def get_data_from_user_instructions(
    run_context: RunContextWrapper[GetDataFromUserContext],
    _agent: Agent[GetDataFromUserContext],
) -> str:
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
            summary="auto",
        ),
    ),
)


class WorkflowInput(BaseModel):
    input_as_text: str


@dataclass
class WorkflowStepSummary:
    key: str
    title: str
    output: str


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


async def run_workflow(
    workflow_input: WorkflowInput,
    *,
    agent_context: AgentContext[Any],
    on_step: Callable[[WorkflowStepSummary, int], Awaitable[None]] | None = None,
    on_step_stream: Callable[[WorkflowStepStreamUpdate], Awaitable[None]] | None = None,
    on_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None = None,
) -> WorkflowRunSummary:
    state: dict[str, Any] = {
        "has_all_details": False,
        "infos_manquantes": None,
    }
    steps: list[WorkflowStepSummary] = []
    workflow = workflow_input.model_dump()
    conversation_history: list[TResponseInputItem] = [
        {
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": workflow["input_as_text"],
                }
            ],
        }
    ]

    def _workflow_run_config() -> RunConfig:
        return RunConfig(
            trace_metadata={
                "__trace_source__": "agent-builder",
                "workflow_id": "wf_68e556bd92048190a549d12e4cf03b220dbf1b19ef9993ae",
            }
        )

    async def record_step(step_key: str, title: str, payload: Any) -> None:
        summary = WorkflowStepSummary(
            key=step_key,
            title=title,
            output=_format_step_output(payload),
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

    def _extract_delta(event: ThreadStreamEvent) -> str:
        if isinstance(event, ThreadItemUpdated):
            update = event.update
            if isinstance(update, AssistantMessageContentPartTextDelta):
                return update.delta or ""
        return ""

    async def run_agent_step(
        step_key: str,
        title: str,
        agent: Agent,
        *,
        agent_context: AgentContext[Any],
        run_context: Any | None = None,
    ) -> _WorkflowStreamResult:
        step_index = len(steps) + 1
        if on_step_stream is not None:
            await on_step_stream(
                WorkflowStepStreamUpdate(
                    key=step_key,
                    title=title,
                    index=step_index,
                    delta="",
                    text="",
                )
            )
        accumulated_text = ""
        result = Runner.run_streamed(
            agent,
            input=[*conversation_history],
            run_config=_workflow_run_config(),
            context=run_context,
        )
        try:
            async for event in stream_agent_response_with_tools(
                agent_context, result
            ):
                if on_stream_event is not None:
                    await on_stream_event(event)
                if on_step_stream is not None:
                    delta_text = _extract_delta(event)
                    if not delta_text:
                        continue
                    accumulated_text += delta_text
                    await on_step_stream(
                        WorkflowStepStreamUpdate(
                            key=step_key,
                            title=title,
                            index=step_index,
                            delta=delta_text,
                            text=accumulated_text,
                        )
                    )
        except Exception as exc:  # pragma: no cover - erreurs propagées au serveur
            raise_step_error(step_key, title, exc)

        conversation_history.extend([item.to_input_item() for item in result.new_items])
        return result

    triage_title = "Analyse des informations fournies"
    triage_result_stream = await run_agent_step(
        "triage",
        triage_title,
        triage,
        agent_context=agent_context,
    )
    triage_parsed, triage_text = _structured_output_as_json(triage_result_stream.final_output)
    triage_result = {
        "output_text": triage_text,
        "output_parsed": triage_parsed,
    }
    if isinstance(triage_parsed, dict):
        state["has_all_details"] = bool(triage_parsed.get("has_all_details"))
    else:
        state["has_all_details"] = False
    state["infos_manquantes"] = triage_result["output_text"]
    await record_step("triage", triage_title, triage_result["output_parsed"])

    if state["has_all_details"] is True:
        redacteur_title = "Rédaction du plan-cadre"
        r_dacteur_result_stream = await run_agent_step(
            "r_dacteur",
            redacteur_title,
            r_dacteur,
            agent_context=agent_context,
        )
        redacteur_parsed, redacteur_text = _structured_output_as_json(
            r_dacteur_result_stream.final_output
        )
        r_dacteur_result = {
            "output_text": redacteur_text,
            "output_parsed": redacteur_parsed,
        }
        await record_step("r_dacteur", redacteur_title, r_dacteur_result["output_text"])
        return WorkflowRunSummary(steps=steps, final_output=r_dacteur_result)

    web_step_title = "Collecte d'exemples externes"
    get_data_from_web_result_stream = await run_agent_step(
        "get_data_from_web",
        web_step_title,
        get_data_from_web,
        agent_context=agent_context,
        run_context=GetDataFromWebContext(state_infos_manquantes=state["infos_manquantes"]),
    )
    get_data_from_web_result = {
        "output_text": get_data_from_web_result_stream.final_output_as(str)
    }
    await record_step(
        "get_data_from_web",
        web_step_title,
        get_data_from_web_result["output_text"],
    )

    triage_2_title = "Validation après collecte"
    triage_2_result_stream = await run_agent_step(
        "triage_2",
        triage_2_title,
        triage_2,
        agent_context=agent_context,
        run_context=Triage2Context(input_output_text=get_data_from_web_result["output_text"]),
    )
    triage_2_parsed, triage_2_text = _structured_output_as_json(
        triage_2_result_stream.final_output
    )
    triage_2_result = {
        "output_text": triage_2_text,
        "output_parsed": triage_2_parsed,
    }
    if isinstance(triage_2_parsed, dict):
        state["has_all_details"] = bool(triage_2_parsed.get("has_all_details"))
    else:
        state["has_all_details"] = False
    state["infos_manquantes"] = triage_2_result["output_text"]
    await record_step("triage_2", triage_2_title, triage_2_result["output_parsed"])

    if state["has_all_details"] is True:
        redacteur_title = "Rédaction du plan-cadre"
        r_dacteur_result_stream = await run_agent_step(
            "r_dacteur",
            redacteur_title,
            r_dacteur,
            agent_context=agent_context,
        )
        redacteur_parsed, redacteur_text = _structured_output_as_json(
            r_dacteur_result_stream.final_output
        )
        r_dacteur_result = {
            "output_text": redacteur_text,
            "output_parsed": redacteur_parsed,
        }
        await record_step("r_dacteur", redacteur_title, r_dacteur_result["output_text"])
        return WorkflowRunSummary(steps=steps, final_output=r_dacteur_result)

    user_step_title = "Demande d'informations supplémentaires"
    get_data_from_user_result_stream = await run_agent_step(
        "get_data_from_user",
        user_step_title,
        get_data_from_user,
        agent_context=agent_context,
        run_context=GetDataFromUserContext(state_infos_manquantes=state["infos_manquantes"]),
    )
    get_data_from_user_result = {
        "output_text": get_data_from_user_result_stream.final_output_as(str)
    }
    await record_step(
        "get_data_from_user",
        user_step_title,
        get_data_from_user_result["output_text"],
    )

    redacteur_title = "Rédaction du plan-cadre"
    r_dacteur_result_stream = await run_agent_step(
        "r_dacteur",
        redacteur_title,
        r_dacteur,
        agent_context=agent_context,
    )
    redacteur_parsed, redacteur_text = _structured_output_as_json(
        r_dacteur_result_stream.final_output
    )
    r_dacteur_result = {
        "output_text": redacteur_text,
        "output_parsed": redacteur_parsed,
    }
    await record_step("r_dacteur", redacteur_title, r_dacteur_result["output_text"])
    return WorkflowRunSummary(steps=steps, final_output=r_dacteur_result)


_server: DemoChatKitServer | None = None


def get_chatkit_server() -> DemoChatKitServer:
    """Retourne l'instance unique du serveur ChatKit."""
    global _server
    if _server is None:
        _server = DemoChatKitServer(get_settings())
    return _server
