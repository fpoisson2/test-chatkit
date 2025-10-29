#!/usr/bin/env python3
"""
Migration script pour convertir les anciennes configurations téléphonie
vers le nouveau système simplifié (is_sip_workflow).

Usage:
    python migrate_sip_workflows.py [--dry-run]

Options:
    --dry-run    Affiche ce qui serait fait sans modifier la base de données
"""

import sys
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.workflows.models import WorkflowStep


def migrate_sip_workflows(dry_run: bool = False) -> None:
    """Migre les workflows avec routes téléphonie vers le nouveau système."""

    db: Session = SessionLocal()
    try:
        # Trouver tous les blocs start avec configuration téléphonie
        steps = db.query(WorkflowStep).filter(
            WorkflowStep.kind == "start",
            WorkflowStep.parameters.isnot(None)
        ).all()

        workflows_with_routes = []
        for step in steps:
            params = step.parameters or {}
            telephony = params.get("telephony", {})

            # Vérifier si ce workflow a des routes
            routes = telephony.get("routes", [])
            if routes:
                workflow_id = step.workflow_definition.workflow_id if step.workflow_definition else None
                workflow_slug = step.workflow_definition.workflow.slug if step.workflow_definition and step.workflow_definition.workflow else "unknown"
                workflows_with_routes.append((step, workflow_slug, len(routes)))

        if not workflows_with_routes:
            print("✓ Aucun workflow avec routes téléphonie trouvé.")
            return

        print(f"📋 Trouvé {len(workflows_with_routes)} workflow(s) avec routes téléphonie:")
        for step, slug, route_count in workflows_with_routes:
            print(f"  - {slug}: {route_count} route(s)")

        if len(workflows_with_routes) == 1:
            # Un seul workflow : le marquer automatiquement
            step, slug, route_count = workflows_with_routes[0]
            print(f"\n✓ Marquage automatique de '{slug}' comme workflow SIP...")

            if not dry_run:
                params = step.parameters or {}
                telephony = params.get("telephony", {})

                # Conserver seulement is_sip_workflow
                new_telephony = {"is_sip_workflow": True}

                params["telephony"] = new_telephony
                step.parameters = params
                db.commit()
                print(f"✓ Workflow '{slug}' migré avec succès!")
            else:
                print(f"  [DRY RUN] Aurait marqué '{slug}' comme workflow SIP")

        else:
            # Plusieurs workflows : demander à l'utilisateur de choisir
            print("\n⚠️  Plusieurs workflows ont des routes téléphonie.")
            print("    Veuillez choisir manuellement le workflow SIP via l'interface.")
            print("    Une fois le workflow SIP défini, relancez ce script pour nettoyer les anciennes configurations.")
            sys.exit(1)

    finally:
        db.close()


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("🔍 Mode DRY RUN activé - aucune modification ne sera effectuée\n")

    migrate_sip_workflows(dry_run=dry_run)
