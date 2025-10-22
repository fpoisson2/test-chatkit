from __future__ import annotations

import json
import keyword
import logging
import re
import weakref
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from agents import Agent, ModelSettings, RunContextWrapper, WebSearchTool
from openai.types.shared.reasoning import Reasoning
from pydantic import BaseModel, Field, create_model

from ..chatkit_server.actions import (
    _patch_model_json_schema,
    _remove_additional_properties_from_schema,
    _sanitize_widget_field_name,
    _StrictSchemaBase,
)
from ..database import SessionLocal
from ..token_sanitizer import sanitize_model_like
from ..tool_factory import (
    build_file_search_tool,
    build_image_generation_tool,
    build_weather_tool,
    build_web_search_tool,
    build_widget_validation_tool,
)

logger = logging.getLogger("chatkit.server")


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
    titre: str
    semaines: str
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
    code: str
    titre: str


class RDacteurSchemaCompetencesCertifieesItem(BaseModel):
    code: str
    titre: str


class RDacteurSchemaCoursCorequisItem(BaseModel):
    code: str
    titre: str


class RDacteurSchemaObjetsCiblesItem(BaseModel):
    titre: str
    description: str


class RDacteurSchemaCoursReliesItem(BaseModel):
    code: str
    titre: str
    description: str


class RDacteurSchemaCoursPrealablesItem(BaseModel):
    code: str
    titre: str
    description: str


class RDacteurSchemaSavoirsFaireCapaciteItem(BaseModel):
    savoir_faire: str
    niveau_cible: str
    seuil_de_reussite: str


class RDacteurSchemaCapaciteItem(BaseModel):
    nom_capacite: str
    description_capacite: str
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


def _coerce_model_settings(value: Any) -> Any:
    if isinstance(value, dict):
        logger.debug("Nettoyage model_settings dict: %s", value)
        result = _model_settings(**value)
        logger.debug(
            "Résultat après nettoyage: %s",
            (
                getattr(result, "model_dump", lambda **_: result)()
                if hasattr(result, "model_dump")
                else result
            ),
        )
        return result
    logger.debug("Nettoyage model_settings objet: %s", value)
    result = sanitize_model_like(value)
    logger.debug(
        "Résultat après nettoyage: %s",
        (
            getattr(result, "model_dump", lambda **_: result)()
            if hasattr(result, "model_dump")
            else result
        ),
    )
    return result


def _clone_tools(value: Sequence[Any] | None) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return list(value)
    if isinstance(value, Sequence) and not isinstance(
        value, str | bytes | bytearray
    ):
        return list(value)
    return [value]


_JSON_TYPE_MAPPING: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def _sanitize_model_name(name: str | None) -> str:
    candidate = (name or "workflow_output").strip()
    sanitized = re.sub(r"[^0-9a-zA-Z_]", "_", candidate) or "workflow_output"
    if sanitized[0].isdigit():
        sanitized = f"model_{sanitized}"
    return sanitized


def _create_response_format_from_pydantic(model: type[BaseModel]) -> dict[str, Any]:
    if hasattr(model, "model_json_schema"):
        schema = model.model_json_schema()
    elif hasattr(model, "schema"):
        schema = model.schema()
    else:
        raise ValueError(f"Cannot generate JSON schema from model {model}")

    schema = _remove_additional_properties_from_schema(schema)

    model_name = getattr(model, "__name__", "Response")
    sanitized_name = _sanitize_model_name(model_name)

    response_format = {
        "type": "json_schema",
        "json_schema": {
            "name": sanitized_name,
            "schema": schema,
            "strict": True,
        },
    }

    try:
        logger.debug(
            "response_format demandé (modèle=%s): %s",
            sanitized_name,
            json.dumps(response_format, ensure_ascii=False),
        )
    except Exception:  # pragma: no cover - sérialisation best effort
        logger.debug(
            "response_format demandé (modèle=%s) - impossible de sérialiser pour "
            "les logs",
            sanitized_name,
        )

    return response_format


def _lookup_known_output_type(name: str) -> type[BaseModel] | None:
    obj = globals().get(name)
    if isinstance(obj, type) and issubclass(obj, BaseModel):
        return obj
    return None


class _JsonSchemaOutputBuilder:
    def __init__(self) -> None:
        self._models: dict[str, type[BaseModel]] = {}

    def build_type(self, schema: Any, *, name: str) -> Any | None:
        if not isinstance(schema, dict):
            return None
        py_type, _nullable = self._resolve(schema, _sanitize_model_name(name))
        return py_type

    def _resolve(self, schema: dict[str, Any], name: str) -> tuple[Any, bool]:
        nullable = False
        schema_type = schema.get("type")

        for combination_key in ("anyOf", "oneOf"):
            options = schema.get(combination_key)
            if not isinstance(options, list) or not options:
                continue

            option_types: list[Any] = []
            option_nullable = False

            for index, option_schema in enumerate(options, start=1):
                if not isinstance(option_schema, dict):
                    return Any, True

                resolved_type, resolved_nullable = self._resolve(
                    option_schema,
                    f"{name}_{combination_key}_{index}",
                )

                if resolved_type is None or resolved_type is Any:
                    return Any, True

                option_types.append(resolved_type)
                if resolved_nullable:
                    option_nullable = True

            if not option_types:
                return Any, True

            unique_types: list[Any] = []
            for candidate in option_types:
                if not any(existing == candidate for existing in unique_types):
                    unique_types.append(candidate)

            if len(unique_types) == 1:
                return unique_types[0], option_nullable

            union_type = unique_types[0]
            for extra in unique_types[1:]:
                union_type = union_type | extra
            return union_type, option_nullable

        if schema_type == "array":
            items_schema = schema.get("items")
            items_type, _ = self._resolve(
                items_schema if isinstance(items_schema, dict) else {},
                f"{name}Item",
            )
            if items_type is None:
                items_type = Any
            return list[items_type], nullable

        if (
            schema_type == "object"
            or "properties" in schema
            or "additionalProperties" in schema
        ):
            return self._build_object(schema, name), nullable

        if isinstance(schema_type, str):
            primitive = _JSON_TYPE_MAPPING.get(schema_type)
            if primitive is not None:
                return primitive, nullable

        return Any, nullable

    def _build_object(self, schema: dict[str, Any], name: str) -> Any:
        sanitized = _sanitize_model_name(name)
        cached = self._models.get(sanitized)
        if cached is not None:
            return cached

        properties = schema.get("properties")
        if not isinstance(properties, dict):
            additional = schema.get("additionalProperties")
            if isinstance(additional, dict):
                value_type, _ = self._resolve(additional, f"{sanitized}Value")
                value_type = value_type if value_type is not None else Any
                return dict[str, value_type]
            if additional:
                return dict[str, Any]
            model = create_model(
                sanitized, __module__=__name__, __base__=_StrictSchemaBase
            )
            _patch_model_json_schema(model)
            self._models[sanitized] = model
            return model

        if not properties:
            model = create_model(
                sanitized, __module__=__name__, __base__=_StrictSchemaBase
            )
            _patch_model_json_schema(model)
            self._models[sanitized] = model
            return model

        sanitized_fields: dict[str, str] = {}
        used_names: set[str] = set()
        for index, prop in enumerate(properties, start=1):
            if not isinstance(prop, str):
                return dict[str, Any]
            if (
                prop.isidentifier()
                and not keyword.iskeyword(prop)
                and prop not in used_names
            ):
                sanitized_fields[prop] = prop
                used_names.add(prop)
                continue

            field_name = _sanitize_widget_field_name(prop, fallback=f"field_{index}")
            if keyword.iskeyword(field_name):
                field_name = f"{field_name}_"
            if field_name in used_names:
                suffix = 1
                base_name = field_name
                while f"{base_name}_{suffix}" in used_names:
                    suffix += 1
                field_name = f"{base_name}_{suffix}"
            used_names.add(field_name)
            sanitized_fields[prop] = field_name

        required_raw = schema.get("required")
        required: set[str] = set()
        if isinstance(required_raw, list):
            for item in required_raw:
                if isinstance(item, str):
                    required.add(item)

        field_definitions: dict[str, tuple[Any, Any]] = {}
        for prop_name, prop_schema in properties.items():
            nested_schema = prop_schema if isinstance(prop_schema, dict) else {}
            prop_type, prop_nullable = self._resolve(
                nested_schema,
                f"{sanitized}_{prop_name}",
            )
            if prop_type is None:
                prop_type = Any
            field_type = prop_type
            is_required = prop_name in required
            if prop_nullable:
                field_type = field_type | None if field_type is not Any else Any
            field_name = sanitized_fields.get(prop_name)
            if field_name is None:
                return dict[str, Any]

            def _build_field(default: Any, *, alias_name: str = prop_name) -> Any:
                try:
                    return Field(
                        default,
                        alias=alias_name,
                        serialization_alias=alias_name,
                    )
                except TypeError:  # pragma: no cover - compatibilité Pydantic v1
                    field = Field(default, alias=alias_name)
                    if hasattr(field, "serialization_alias"):
                        try:
                            field.serialization_alias = alias_name
                        except Exception:
                            pass
                    return field

            if not is_required:
                if not prop_nullable:
                    field_type = field_type | None if field_type is not Any else Any
                field_definitions[field_name] = (
                    field_type,
                    _build_field(default=None),
                )
            else:
                field_definitions[field_name] = (
                    field_type,
                    _build_field(default=Ellipsis),
                )

        model = create_model(
            sanitized,
            __module__=__name__,
            __base__=_StrictSchemaBase,
            **field_definitions,
        )
        _patch_model_json_schema(model)
        self._models[sanitized] = model
        return model


def _build_output_type_from_response_format(
    response_format: Any, *, fallback: Any | None
) -> Any | None:
    if not isinstance(response_format, dict):
        logger.warning(
            "Format de réponse agent invalide (type inattendu) : %s. "
            "Utilisation du type existant.",
            response_format,
        )
        return fallback

    fmt_type = response_format.get("type")
    if fmt_type != "json_schema":
        logger.warning(
            "Format de réponse %s non pris en charge, utilisation du type existant.",
            fmt_type,
        )
        return fallback

    schema_payload: Any | None = None
    schema_name_raw: str | None = None

    json_schema = response_format.get("json_schema")
    if isinstance(json_schema, Mapping):
        schema_name_raw = (
            json_schema.get("name")
            if isinstance(json_schema.get("name"), str)
            else None
        )
        schema_payload = (
            json_schema.get("schema")
            if isinstance(json_schema.get("schema"), Mapping)
            else json_schema.get("schema")
        )
    elif json_schema is not None:
        logger.warning(
            "Format JSON Schema invalide (clé 'json_schema' inattendue) pour la "
            "configuration agent : %s. Utilisation du type existant.",
            response_format,
        )
        return fallback

    if schema_name_raw is None:
        alt_name = response_format.get("name")
        if isinstance(alt_name, str) and alt_name.strip():
            schema_name_raw = alt_name

    original_name = (
        schema_name_raw
        if isinstance(schema_name_raw, str) and schema_name_raw.strip()
        else None
    )
    schema_name = _sanitize_model_name(original_name)

    if schema_payload is None:
        schema_payload = response_format.get("schema")

    if not isinstance(schema_payload, Mapping):
        logger.warning(
            "Format JSON Schema sans contenu pour %s, utilisation du type existant.",
            schema_name,
        )
        return fallback
    schema_payload = dict(schema_payload)

    known = None
    if original_name:
        known = _lookup_known_output_type(original_name)
    if known is None:
        known = _lookup_known_output_type(schema_name)
    if known is not None:
        return known

    builder = _JsonSchemaOutputBuilder()
    built = builder.build_type(schema_payload, name=schema_name)
    if built is None:
        logger.warning(
            "Impossible de construire un output_type depuis le schéma %s, "
            "utilisation du type existant.",
            schema_name,
        )
        return fallback

    return built


def _coerce_agent_tools(
    value: Any, fallback: Sequence[Any] | None = None
) -> Sequence[Any] | None:
    if value is None:
        return _clone_tools(fallback)

    if not isinstance(value, list):
        return value

    coerced: list[Any] = []
    for entry in value:
        if isinstance(entry, WebSearchTool):
            coerced.append(entry)
            continue

        if isinstance(entry, dict):
            tool_type = entry.get("type") or entry.get("tool") or entry.get("name")
            normalized_type = (
                tool_type.strip().lower() if isinstance(tool_type, str) else ""
            )

            if normalized_type == "web_search":
                tool = build_web_search_tool(entry.get("web_search"))
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "file_search":
                tool = build_file_search_tool(entry.get("file_search"))
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "image_generation":
                tool = build_image_generation_tool(entry)
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "function":
                function_payload = entry.get("function")
                tool = build_weather_tool(function_payload)
                if tool is None:
                    tool = build_widget_validation_tool(function_payload)
                if tool is not None:
                    coerced.append(tool)
                continue

    if coerced:
        return coerced

    if value:
        logger.warning(
            "Outils agent non reconnus (%s), utilisation de la configuration par "
            "défaut.",
            value,
        )
        return _clone_tools(fallback)

    return []


def _build_response_format_from_widget(
    response_widget: dict[str, Any],
) -> dict[str, Any] | None:
    logger.info(
        "_build_response_format_from_widget appelée avec: %s",
        response_widget,
    )

    if not isinstance(response_widget, dict):
        return None

    source = response_widget.get("source")
    if source != "library":
        logger.debug(
            "response_widget avec source '%s' non géré, seule 'library' est supportée",
            source,
        )
        return None

    slug = response_widget.get("slug")
    if not isinstance(slug, str) or not slug.strip():
        logger.warning(
            "response_widget de type 'library' sans slug valide : %s",
            response_widget,
        )
        return None

    try:
        from .widgets.service import WidgetLibraryService
    except ImportError:
        logger.warning(
            "Impossible d'importer WidgetLibraryService pour traiter response_widget",
        )
        return None

    try:
        session = SessionLocal()
        try:
            widget_service = WidgetLibraryService(session)
            widget_entry = widget_service.get_widget(slug)
        finally:
            session.close()

        if widget_entry is None:
            logger.warning(
                "Widget '%s' introuvable dans la bibliothèque",
                slug,
            )
            return None

        widget_variables = response_widget.get("variables", {})

        logger.debug(
            "Variables extraites du widget '%s': %s (type: %s)",
            slug,
            widget_variables,
            type(widget_variables).__name__,
        )

        properties = {}
        required = []

        for var_path in widget_variables.keys():
            safe_key = _sanitize_widget_field_name(
                var_path, fallback=var_path.replace(".", "_")
            )

            properties[safe_key] = {
                "type": "string",
                "description": f"Valeur pour {var_path}",
            }
            required.append(safe_key)

        logger.debug(
            "Propriétés générées pour le widget '%s': %s",
            slug,
            list(properties.keys()),
        )

        if not properties:
            try:
                from chatkit.widgets import WidgetRoot
            except ImportError:
                logger.warning(
                    "Impossible d'importer WidgetRoot pour générer le schéma du widget",
                )
                return None

            try:
                if hasattr(WidgetRoot, "model_json_schema"):
                    schema = WidgetRoot.model_json_schema()
                elif hasattr(WidgetRoot, "schema"):
                    schema = WidgetRoot.schema()
                else:
                    logger.warning(
                        "Impossible de générer le schéma JSON pour WidgetRoot",
                    )
                    return None

                schema = _remove_additional_properties_from_schema(schema)
            except Exception as exc:
                logger.exception(
                    "Erreur lors de la génération du schéma JSON pour le widget '%s'",
                    slug,
                    exc_info=exc,
                )
                return None
        else:
            schema = {
                "type": "object",
                "properties": properties,
                "required": required,
            }

        widget_name = widget_entry.title or slug
        response_format: dict[str, Any] = {
            "type": "json_schema",
            "name": f"widget_{slug.replace('-', '_')}",
            "schema": schema,
            "strict": True,
        }
        description = widget_entry.description or f"Widget {widget_name}"
        if description:
            response_format["description"] = description

        logger.info(
            "response_format généré depuis le widget de bibliothèque '%s' "
            "(variables: %s)",
            slug,
            list(widget_variables.keys()) if widget_variables else "aucune",
        )
        try:
            logger.debug(
                "response_format demandé pour le widget '%s': %s",
                slug,
                json.dumps(response_format, ensure_ascii=False),
            )
        except Exception:  # pragma: no cover - sérialisation best effort
            logger.debug(
                "response_format demandé pour le widget '%s' - impossible de "
                "sérialiser pour les logs",
                slug,
            )
        return response_format

    except Exception as exc:
        logger.exception(
            "Erreur lors de la récupération du widget '%s' depuis la bibliothèque",
            slug,
            exc_info=exc,
        )
        return None


def _build_agent_kwargs(
    base_kwargs: dict[str, Any], overrides: dict[str, Any] | None
) -> dict[str, Any]:
    merged = {**base_kwargs}
    if overrides:
        for key, value in overrides.items():
            merged[key] = value

    response_widget = merged.pop("response_widget", None)
    sync_output_type = True

    if response_widget is not None and "response_format" not in merged:
        generated_format = _build_response_format_from_widget(response_widget)
        if generated_format is not None:
            merged["response_format"] = generated_format
            merged.pop("output_type", None)
            sync_output_type = False
    if "model_settings" in merged:
        merged["model_settings"] = _coerce_model_settings(merged["model_settings"])
    if "tools" in merged:
        merged["tools"] = _coerce_agent_tools(
            merged["tools"], base_kwargs.get("tools") if base_kwargs else None
        )
    if "response_format" in merged:
        response_format = merged.pop("response_format")
        if sync_output_type:
            output_type = merged.get("output_type")
            resolved = _build_output_type_from_response_format(
                response_format,
                fallback=output_type,
            )
            if resolved is not None:
                merged["output_type"] = resolved
            elif "output_type" not in base_kwargs and "output_type" in merged:
                merged.pop("output_type", None)
        else:
            merged.pop("output_type", None)
        merged["_response_format_override"] = response_format
    return merged


AGENT_RESPONSE_FORMATS: weakref.WeakKeyDictionary[Agent, dict[str, Any]] = (
    weakref.WeakKeyDictionary()
)


def _instantiate_agent(kwargs: dict[str, Any]) -> Agent:
    response_format = kwargs.pop("_response_format_override", None)
    agent = Agent(**kwargs)
    if response_format is not None:
        try:
            agent.response_format = response_format
        except Exception:
            logger.debug(
                "Impossible d'attacher response_format directement à l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
        try:
            agent._chatkit_response_format = response_format
        except Exception:
            logger.debug(
                "Impossible de stocker _chatkit_response_format pour l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
        try:
            AGENT_RESPONSE_FORMATS[agent] = response_format
        except Exception:
            logger.debug(
                "Impossible de mémoriser le response_format pour l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
    return agent


web_search_preview = WebSearchTool(
    search_context_size="medium",
    user_location={
        "city": "Québec",
        "country": "CA",
        "region": "QC",
        "type": "approximate",
    },
)


def _build_triage_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Triage",
        "instructions": (
            """Ton rôle : Vérifier si toutes les informations nécessaires sont
présentes pour générer un plan-cadre.
Si oui → has_all_details: true
Sinon → has_all_details: false + lister uniquement les éléments manquants

Ne génère pas encore le plan-cadre.

Informations attendues
Le plan-cadre pourra être généré seulement si les champs suivants sont
fournis :
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
competence_nom:               # Pour la section Description des compétences
                               # développées
cours_developpant_une_meme_competence: []  # Pour les activités pratiques
Une idée générale de ce qui devrait se retrouver dans le cours."""
        ),
        "model": "gpt-5",
        "output_type": TriageSchema,
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="minimal",
                summary="auto",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


def _build_thread_title_agent() -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "TitreFil",
        "model": "gpt-5-nano",
        "instructions": (
            """Propose un titre court et descriptif en français pour un nouveau fil
de discussion.
Utilise au maximum 6 mots."""
        ),
        "model_settings": _model_settings(store=True),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, None))


R_DACTEUR_INSTRUCTIONS = """Tu es un assistant pédagogique qui génère, en français,
des contenus de plan-cadre selon le ton institutionnel : clairs, concis,
rigoureux, rédigés au vouvoiement. Tu ne t’appuies que sur les informations
fournies dans le prompt utilisateur, sans inventer de contenu. Si une information
manque et qu’aucune directive de repli n’est donnée, omets l’élément manquant.

**CONTRAINTE SPÉCIALE – SAVOIR ET SAVOIR-FAIRE PAR CAPACITÉ**
Pour chaque capacité identifiée dans le cours, tu dois générer explicitement :
- La liste des savoirs nécessaires à la maîtrise de cette capacité (minimum 10 par
  capacité)
- La liste des savoir-faire associés à cette même capacité (minimum 10 par
  capacité, chacun avec niveau cible et seuil)

Ton rôle est de récupérer les informations manquantes pour rédiger le plan-cadre.
Demande à l'utilisateur les informations manquantes.

SECTIONS ET RÈGLES DE GÉNÉRATION

## Intro et place du cours
Génère une description détaillée pour le cours «{{code_cours}} – {{nom_cours}}» qui
s’inscrit dans le fil conducteur «{{fil_conducteur}}» du programme de {{programme}}
et se donne en session {{session}} de la grille de cours.

La description devra comporter :

Une introduction qui situe le cours dans son contexte (code, nom, fil conducteur,
programme et session).

Une explication sur l’importance des connaissances préalables pour réussir ce
cours.

Pour chaque cours préalable listé dans {{cours_prealables}}, détaille les
connaissances et compétences essentielles acquises et explique en quoi ces acquis
sont indispensables pour aborder les notions spécifiques du cours actuel.

Le texte final doit adopter un style clair et pédagogique, similaire à l’exemple
suivant, mais adapté au contenu du présent cours :

"Le cours «243-4Q4 – Communication radio» s’inscrit dans le fil conducteur
«Sans-fil et fibre optique» du programme de Technologie du génie électrique :
Réseaux et télécommunications et se donne en session 4. Afin de bien réussir ce
cours, il est essentiel de maîtriser les connaissances préalables acquises dans
«nom du cours», particulièrement [connaissances et compétences]. Ces acquis
permettront aux personnes étudiantes de saisir plus aisément les notions
abordées dans le présent cours."

---

## Objectif terminal
Écris un objectif terminal pour le cours {{nom_cours}} qui commence par
"Au terme de ce cours, les personnes étudiantes seront capables de" et se termine
par un objectif correspondant aux compétences à développer ou à atteindre
({{competences_developpees}}{{competences_atteintes}}). L’énoncé doit être clair
et comporter uniquement deux ou trois actes. Utilise le nom du cours pour
décrire les technologies abordées.

---

## Introduction Structure du Cours
Le cours «{{nom_cours}}» prévoit {{heures_theorie}} heures de théorie,
{{heures_lab}} heures d’application en travaux pratiques ou en laboratoire et
{{heures_maison}} heures de travail personnel par semaine.

---

## Activités Théoriques
Écris un texte adapté à la nature du cours ({{nom_cours}}), similaire en longueur
et en style à ce modèle :

"Les séances théoriques du cours visent à préparer les personnes étudiantes en
vue de la mise en pratique de leurs connaissances au laboratoire. Ces séances
seront axées sur plusieurs aspects, notamment les éléments constitutifs des
systèmes électroniques analogiques utilisés en télécommunications. Les personnes
étudiantes approfondiront leur compréhension par des discussions interactives,
des exercices et des analyses de cas liés à l’installation et au fonctionnement
des systèmes électroniques analogiques."

---

## Activités Pratiques
Écris un texte adapté à la nature du cours {{nom_cours}}, similaire en longueur et
en style. Le premier chiffre après 243 indique la session sur six et le nom du
cours décrit le matériel ou la technologie utilisée.

Voici les cours reliés :
{{cours_developpant_une_meme_competence}}

Voici un exemple provenant d'un autre cours :
"La structure des activités pratiques sur les 15 semaines du cours se déroulera
de manière progressive et devrait se dérouler en quatre phases. La première phase
devrait s’inspirer du quotidien des personnes étudiantes qui, généralement, ont
simplement utilisé des systèmes électroniques. Son objectif serait de favoriser
la compréhension des composants essentiels des systèmes électroniques
analogiques. Cela devrait conduire à une compréhension d’un système d’alimentation
basé sur des panneaux solaires photovoltaïques, offrant une introduction pertinente
aux systèmes d’alimentation en courant continu utilisés dans les
télécommunications. La seconde phase mènerait la personne à comprendre la nature
des signaux alternatifs dans le cadre de systèmes d’alimentation en courant
alternatif et sur des signaux audios. La troisième phase viserait une exploration
des systèmes de communication radio. Finalement, la dernière phase viserait à
réaliser un projet final combinant les apprentissages réalisés, en partenariat
avec les cours 243-1N5-LI - Systèmes numériques et 243-1P4-LI – Travaux d’atelier."

---

## Activités Prévues
Décris les différentes phases de manière succincte en utilisant cette forme.
N’oublie pas que la session dure 15 semaines.

**Phase X - titre de la phase (Semaines Y à Z)**
  - Description de la phase

---

## Évaluation Sommative des Apprentissages
Pour la réussite du cours, la personne étudiante doit obtenir la note de 60 % en
faisant la somme pondérée des capacités.

La note attribuée à une capacité n’est pas nécessairement la moyenne cumulative
des évaluations pour cette capacité, mais bien le reflet des observations faites
en cours de session par la personne enseignante et de son jugement global.

---

## Nature des Évaluations Sommatives
Inclure un texte similaire à celui-ci :

"L’évaluation sommative devrait surtout être réalisée à partir de travaux
pratiques effectués en laboratoire, alignés avec le savoir-faire évalué. Les
travaux pratiques pourraient prendre la forme de..."

Pour certains savoirs, de courts examens théoriques peuvent être privilégiés,
par exemple pour les savoirs suivants :
...

---

## Évaluation de la Langue
Utilise ce modèle :

"Dans un souci de valorisation de la langue, l’évaluation de l’expression et de
la communication en français se fera de façon constante par l’enseignant(e) sur
une base formative, à l’oral ou à l’écrit. Son évaluation se fera sur une base
sommative pour les savoir-faire reliés à la documentation. Les critères
d’évaluation se trouvent au plan général d’évaluation sommative présenté à la
page suivante. Les dispositions pour la valorisation de l’expression et de la
communication en français sont encadrées par les modalités particulières
d’application de l’article 6.6 de la PIEA (Politique institutionnelle
d’évaluation des apprentissages) et sont précisées dans le plan de cours."

Pour chaque capacité, génère immédiatement après son texte et sa pondération :
- La liste complète de ses savoirs nécessaires
- La liste complète de ses savoir-faire associés (avec cible et seuil)
- Les moyens d’évaluation pertinents pour cette capacité

Génère les autres sections exactement comme décrit, sans ajout ni omission
spontanée.
"""


def _build_r_dacteur_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Rédacteur",
        "instructions": R_DACTEUR_INSTRUCTIONS,
        "model": "gpt-4.1-mini",
        "output_type": RDacteurSchema,
        "model_settings": _model_settings(
            temperature=1,
            top_p=1,
            store=True,
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


class GetDataFromWebContext:
    def __init__(self, state_infos_manquantes: str) -> None:
        self.state_infos_manquantes = state_infos_manquantes


def get_data_from_web_instructions(
    run_context: RunContextWrapper[GetDataFromWebContext],
    _agent: Agent[GetDataFromWebContext],
) -> str:
    state_infos_manquantes = run_context.context.state_infos_manquantes
    return f"""Ton rôle est de récupérer les informations manquantes pour rédiger
le plan-cadre.
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


def _build_get_data_from_web_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Get data from web",
        "instructions": get_data_from_web_instructions,
        "model": "gpt-5-mini",
        "tools": [web_search_preview],
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="medium",
                summary="auto",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


class Triage2Context:
    def __init__(self, input_output_text: str) -> None:
        self.input_output_text = input_output_text


def triage_2_instructions(
    run_context: RunContextWrapper[Triage2Context],
    _agent: Agent[Triage2Context],
) -> str:
    input_output_text = run_context.context.input_output_text
    return (
        "Ton rôle : Vérifier si toutes les informations nécessaires sont "
        "présentes pour générer un plan-cadre.\n"
        "Si oui → has_all_details: true\n"
        "Sinon → has_all_details: false + lister uniquement les éléments manquants\n\n"
        "Ne génère pas encore le plan-cadre.\n\n"
        "Informations attendues\n"
        "Le plan-cadre pourra être généré seulement si les champs suivants "
        "sont fournis :\n"
        "code_cours:\n"
        "nom_cours:\n"
        "programme:\n"
        "fil_conducteur:\n"
        "session:\n"
        "cours_prealables: []       # Codes + titres\n"
        "cours_requis: []           # (optionnel)\n"
        "cours_reliés: []           # (optionnel)\n"
        "heures_theorie:\n"
        "heures_lab:\n"
        "heures_maison:\n"
        "competences_developpees: []   # Codes + titres\n"
        "competences_atteintes: []     # Codes + titres\n"
        "competence_nom:               # Pour la section Description des compétences\n"
        "cours_developpant_une_meme_competence: []  # Pour les activités pratiques\n"
        "Une idée générale de ce qui devrait se retrouver dans le cours.\n\n"
        f"Voici les informations connues {input_output_text}"
    )


def _build_triage_2_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Triage 2",
        "instructions": triage_2_instructions,
        "model": "gpt-5",
        "output_type": Triage2Schema,
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="minimal",
                summary="auto",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


class GetDataFromUserContext:
    def __init__(self, state_infos_manquantes: str) -> None:
        self.state_infos_manquantes = state_infos_manquantes


def get_data_from_user_instructions(
    run_context: RunContextWrapper[GetDataFromUserContext],
    _agent: Agent[GetDataFromUserContext],
) -> str:
    state_infos_manquantes = run_context.context.state_infos_manquantes
    return (
        "Ton rôle est de récupérer les informations manquantes pour rédiger "
        "le plan-cadre.\n\n"
        "Arrête-toi et demande à l'utilisateur les informations manquantes.\n"
        "infos manquantes:\n"
        f" {state_infos_manquantes}\n"
    )


def _build_get_data_from_user_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "Get data from user",
        "instructions": get_data_from_user_instructions,
        "model": "gpt-5-nano",
        "model_settings": _model_settings(
            store=True,
            reasoning=Reasoning(
                effort="medium",
                summary="auto",
            ),
        ),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, overrides))


_CUSTOM_AGENT_FALLBACK_NAME = "Agent personnalisé"


def _build_custom_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {"name": _CUSTOM_AGENT_FALLBACK_NAME}
    merged = _build_agent_kwargs(base_kwargs, overrides or {})
    name = merged.get("name")
    if not isinstance(name, str) or not name.strip():
        merged["name"] = _CUSTOM_AGENT_FALLBACK_NAME
    return _instantiate_agent(merged)


AGENT_BUILDERS: dict[str, Callable[[dict[str, Any] | None], Agent]] = {
    "triage": _build_triage_agent,
    "r_dacteur": _build_r_dacteur_agent,
    "get_data_from_web": _build_get_data_from_web_agent,
    "triage_2": _build_triage_2_agent,
    "get_data_from_user": _build_get_data_from_user_agent,
}


STEP_TITLES: dict[str, str] = {
    "triage": "Analyse des informations fournies",
    "r_dacteur": "Rédaction du plan-cadre",
    "get_data_from_web": "Collecte d'exemples externes",
    "triage_2": "Validation après collecte",
    "get_data_from_user": "Demande d'informations supplémentaires",
}


__all__ = [
    "AGENT_BUILDERS",
    "AGENT_RESPONSE_FORMATS",
    "GetDataFromUserContext",
    "GetDataFromWebContext",
    "R_DACTEUR_INSTRUCTIONS",
    "STEP_TITLES",
    "Triage2Context",
    "Triage2Schema",
    "TriageSchema",
    "RDacteurSchema",
    "_build_agent_kwargs",
    "_build_custom_agent",
    "_build_get_data_from_user_agent",
    "_build_get_data_from_web_agent",
    "_build_r_dacteur_agent",
    "_build_thread_title_agent",
    "_build_triage_2_agent",
    "_build_triage_agent",
    "_coerce_agent_tools",
    "_create_response_format_from_pydantic",
    "_instantiate_agent",
    "get_data_from_user_instructions",
    "get_data_from_web_instructions",
    "triage_2_instructions",
    "web_search_preview",
]
