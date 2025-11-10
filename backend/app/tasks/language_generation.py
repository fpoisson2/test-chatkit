"""
Tâches Celery pour la génération de langues.
"""
from __future__ import annotations

import datetime
import json
import logging
import re

from sqlalchemy import select

from ..celery_app import celery_app
from ..database import SessionLocal
from ..i18n_utils import resolve_frontend_i18n_path
from ..models import AvailableModel, Language, LanguageGenerationTask

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.language_generation.generate_language_task")
def generate_language_task(
    self,
    task_id: str,
    code: str,
    name: str,
    model_name: str | None,
    provider_id: str | None,
    provider_slug: str | None,
    custom_prompt: str | None,
    save_to_db: bool,
):
    """
    Tâche Celery pour générer une langue en background.

    Cette tâche :
    1. Charge le modèle et provider
    2. Extrait les traductions EN
    3. Met à jour le statut et la progression
    4. Crée un agent pour la traduction
    5. Exécute la traduction
    6. Sauvegarde en BD si demandé
    7. Génère le fichier .ts
    8. Met à jour le statut final

    Args:
        self: Instance de la tâche Celery (bind=True)
        task_id: ID de la tâche dans la BD
        code: Code langue ISO 639-1
        name: Nom de la langue
        model_name: Nom du modèle à utiliser
        provider_id: ID du provider
        provider_slug: Slug du provider
        custom_prompt: Prompt personnalisé
        save_to_db: Sauvegarder en BD
    """
    # Imports locaux pour éviter les problèmes de sérialisation Celery
    import asyncio

    from agents import Agent, RunConfig, Runner

    from ..chatkit.agent_registry import create_litellm_model, get_agent_provider_binding

    try:
        # Utiliser SessionLocal pour créer une session dans la tâche Celery
        with SessionLocal() as session:
            # Charger la tâche
            task = session.scalar(
                select(LanguageGenerationTask).where(
                    LanguageGenerationTask.task_id == task_id
                )
            )
            if not task:
                logger.error(f"Task {task_id} not found in database")
                return

            try:
                # Étape 1: Charger les traductions anglaises
                i18n_path, path_exists = resolve_frontend_i18n_path()
                en_file = i18n_path / "translations.en.ts"

                if not path_exists or not en_file.exists():
                    raise ValueError("Source language file (English) not found")

                en_content = en_file.read_text()
                pattern = r'"([^"]+)"\s*:\s*"([^"]*(?:\\.[^"]*)*)"'
                matches = re.findall(pattern, en_content)

                if not matches:
                    raise ValueError("No translations found in source file")

                en_translations = {key: value for key, value in matches}

                # Mettre à jour: status = running, progress = 10
                task.status = "running"
                task.progress = 10
                session.commit()

                logger.info(
                    f"Task {task_id}: Starting translation for {code} ({name}) "
                    f"with {len(en_translations)} keys"
                )

                # Mettre à jour progress via Celery
                self.update_state(
                    state="PROGRESS",
                    meta={"current": 10, "total": 100, "status": "Loading model..."},
                )

                # Étape 2: Charger le modèle et provider
                if model_name:
                    query = select(AvailableModel).where(
                        AvailableModel.name == model_name
                    )
                    available_model = session.scalar(query)
                    if not available_model:
                        raise ValueError(f"Model '{model_name}' not found in database")
                else:
                    available_model = session.scalar(
                        select(AvailableModel).order_by(AvailableModel.id).limit(1)
                    )
                    if not available_model:
                        raise ValueError("No models configured in the database")

                model_name = available_model.name

                # Résoudre le provider
                if provider_id or provider_slug:
                    provider_id_used = provider_id
                    provider_slug_used = provider_slug
                else:
                    provider_id_used = None
                    provider_slug_used = available_model.provider_slug

                provider_binding = get_agent_provider_binding(
                    provider_id_used, provider_slug_used
                )
                if not provider_binding:
                    raise ValueError(
                        f"Failed to get provider binding for model '{model_name}'"
                    )

                # Étape 3: Préparer le prompt
                translations_json = json.dumps(
                    en_translations, ensure_ascii=False, indent=2
                )

                if custom_prompt:
                    prompt = custom_prompt.replace("{{language_name}}", name)
                    prompt = prompt.replace("{{language_code}}", code)
                    prompt = prompt.replace("{{translations_json}}", translations_json)
                else:
                    prompt = (
                        "You are a professional translator. Translate the "
                        "following JSON object containing interface strings "
                        f"from English to {name} ({code}).\n\n"
                        "IMPORTANT RULES:\n"
                        "1. Keep all keys exactly as they are (do not translate "
                        "keys)\n"
                        "2. Only translate the values\n"
                        "3. Preserve any placeholders like {{variable}}, "
                        "{{count}}, etc.\n"
                        "4. Preserve any HTML tags or special formatting\n"
                        "5. Maintain the same level of formality/informality as "
                        "the source\n"
                        "6. Return ONLY the translated JSON object, nothing else\n\n"
                        "Source translations (English):\n"
                        f"{translations_json}\n\n"
                        "Return the complete JSON object with all keys and their "
                        f"translated values in {name}."
                    )

                # Mettre à jour progress = 20
                task.progress = 20
                session.commit()
                self.update_state(
                    state="PROGRESS",
                    meta={"current": 20, "total": 100, "status": "Creating agent..."},
                )

                # Étape 4: Créer l'agent et exécuter
                model_instance = create_litellm_model(model_name, provider_binding)
                agent = Agent(
                    name="Language Translator",
                    model=model_instance,
                    instructions=prompt,
                )
                agent._chatkit_provider_binding = provider_binding

                # Mettre à jour progress = 30
                task.progress = 30
                session.commit()
                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 30,
                        "total": 100,
                        "status": "Translating with AI...",
                    },
                )

                logger.info(f"Task {task_id}: Executing translation agent")

                run_config_kwargs = {}
                if provider_binding is not None:
                    run_config_kwargs["model_provider"] = provider_binding.provider

                try:
                    run_config = RunConfig(**run_config_kwargs)
                except TypeError:
                    run_config_kwargs.pop("model_provider", None)
                    run_config = RunConfig(**run_config_kwargs)

                # Exécuter de manière synchrone dans le worker Celery
                # Celery workers peuvent gérer les appels async
                result = asyncio.run(
                    Runner.run(
                        agent,
                        input="Translate the provided JSON to the target language.",
                        run_config=run_config,
                    )
                )

                # Mettre à jour progress = 80
                task.progress = 80
                session.commit()
                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 80,
                        "total": 100,
                        "status": "Processing results...",
                    },
                )

                logger.info(f"Task {task_id}: Translation completed, processing result")

                # Étape 5: Extraire et parser la réponse
                response_text = (
                    result.output if hasattr(result, "output") else str(result)
                )
                json_match = re.search(r"\{.*\}", response_text, re.DOTALL)
                if not json_match:
                    raise ValueError("Failed to extract JSON from AI response")

                translated_dict = json.loads(json_match.group(0))
                logger.info(
                    f"Task {task_id}: Successfully translated "
                    f"{len(translated_dict)} keys"
                )

                # Étape 6: Générer le fichier .ts
                file_content = (
                    'import type { TranslationDictionary } from "./translations";\n\n'
                    f"export const {code}: TranslationDictionary = {{\n"
                )
                for key, value in translated_dict.items():
                    escaped_value = value.replace("\\", "\\\\").replace('"', '\\"')
                    file_content += f'  "{key}": "{escaped_value}",\n'
                file_content += "};\n"

                task.file_content = file_content

                # Étape 7: Si save_to_db, créer/update Language en BD
                language_id = None
                if save_to_db:
                    logger.info(f"Task {task_id}: Saving to database")
                    existing_lang = session.scalar(
                        select(Language).where(Language.code == code)
                    )

                    if existing_lang:
                        existing_lang.name = name
                        existing_lang.translations = translated_dict
                        existing_lang.updated_at = datetime.datetime.now(datetime.UTC)
                        language = existing_lang
                    else:
                        language = Language(
                            code=code, name=name, translations=translated_dict
                        )
                        session.add(language)

                    session.commit()
                    session.refresh(language)
                    language_id = language.id
                    task.language_id = language_id
                    logger.info(
                        f"Task {task_id}: Saved to database with "
                        f"language_id={language_id}"
                    )

                # Étape 8: Marquer comme terminé
                task.status = "completed"
                task.progress = 100
                task.completed_at = datetime.datetime.now(datetime.UTC)
                session.commit()

                logger.info(f"Task {task_id}: Completed successfully")

                return {
                    "status": "completed",
                    "task_id": task_id,
                    "code": code,
                    "name": name,
                    "language_id": language_id,
                }

            except Exception as e:
                # En cas d'erreur, marquer la tâche comme failed
                logger.exception(f"Task {task_id} failed: {e}")
                task.status = "failed"
                task.error_message = str(e)
                task.progress = 0
                session.commit()

                # Propager l'erreur pour Celery
                raise

    except Exception as e:
        # Erreur fatale (impossible de charger la tâche)
        logger.exception(f"Fatal error in Celery task for {task_id}: {e}")
        raise
