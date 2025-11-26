"""
Module de conversion DOCX vers PDF utilisant LibreOffice en mode headless.

Ce module permet de convertir automatiquement les fichiers DOCX uploadés
en PDF pour une meilleure compatibilité avec les modèles d'IA.
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import subprocess
import tempfile
from pathlib import Path

logger = logging.getLogger(__name__)

# Types MIME pour les fichiers DOCX
DOCX_MIME_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",  # Pour les anciens fichiers .doc
}

# Extensions de fichiers DOCX
DOCX_EXTENSIONS = {".docx", ".doc"}


def is_docx_file(filename: str, mime_type: str | None = None) -> bool:
    """
    Vérifie si un fichier est un document Word (DOCX/DOC).

    Args:
        filename: Nom du fichier
        mime_type: Type MIME optionnel

    Returns:
        True si le fichier est un document Word
    """
    ext = Path(filename).suffix.lower()
    if ext in DOCX_EXTENSIONS:
        return True
    if mime_type and mime_type in DOCX_MIME_TYPES:
        return True
    return False


def get_libreoffice_path() -> str | None:
    """
    Trouve le chemin de l'exécutable LibreOffice.

    Returns:
        Chemin vers l'exécutable ou None si non trouvé
    """
    # Essayer différents chemins possibles
    possible_paths = [
        "libreoffice",
        "soffice",
        "/usr/bin/libreoffice",
        "/usr/bin/soffice",
        "/usr/lib/libreoffice/program/soffice",
    ]

    for path in possible_paths:
        if shutil.which(path):
            return path

    return None


async def convert_docx_to_pdf(
    input_path: Path,
    output_path: Path | None = None,
    timeout: int = 60,
) -> Path:
    """
    Convertit un fichier DOCX en PDF en utilisant LibreOffice.

    Args:
        input_path: Chemin vers le fichier DOCX source
        output_path: Chemin de destination pour le PDF (optionnel)
        timeout: Timeout en secondes pour la conversion

    Returns:
        Chemin vers le fichier PDF généré

    Raises:
        FileNotFoundError: Si le fichier source n'existe pas
        RuntimeError: Si LibreOffice n'est pas installé ou si la conversion échoue
    """
    if not input_path.exists():
        raise FileNotFoundError(f"Fichier source non trouvé: {input_path}")

    libreoffice_path = get_libreoffice_path()
    if not libreoffice_path:
        raise RuntimeError(
            "LibreOffice n'est pas installé. "
            "Installez libreoffice-writer-nogui pour la conversion DOCX vers PDF."
        )

    # Si pas de chemin de sortie spécifié, utiliser le même répertoire
    if output_path is None:
        output_path = input_path.with_suffix(".pdf")

    # Utiliser un répertoire temporaire pour la conversion
    # LibreOffice génère le fichier dans le répertoire de sortie
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)

        # Commande LibreOffice pour conversion
        cmd = [
            libreoffice_path,
            "--headless",
            "--convert-to", "pdf",
            "--outdir", str(temp_dir_path),
            str(input_path),
        ]

        logger.info(f"Conversion DOCX vers PDF: {input_path.name}")

        try:
            # Exécuter la conversion de manière asynchrone
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout,
            )

            if process.returncode != 0:
                error_msg = stderr.decode() if stderr else "Erreur inconnue"
                raise RuntimeError(
                    f"Échec de la conversion DOCX vers PDF: {error_msg}"
                )

            # Trouver le fichier PDF généré
            pdf_name = input_path.stem + ".pdf"
            temp_pdf_path = temp_dir_path / pdf_name

            if not temp_pdf_path.exists():
                raise RuntimeError(
                    f"Le fichier PDF n'a pas été généré: {pdf_name}"
                )

            # Déplacer le PDF vers la destination finale
            shutil.move(str(temp_pdf_path), str(output_path))

            logger.info(f"Conversion réussie: {output_path.name}")
            return output_path

        except asyncio.TimeoutError:
            raise RuntimeError(
                f"Timeout lors de la conversion DOCX vers PDF "
                f"(limite: {timeout}s)"
            )


def convert_docx_to_pdf_sync(
    input_path: Path,
    output_path: Path | None = None,
    timeout: int = 60,
) -> Path:
    """
    Version synchrone de convert_docx_to_pdf.

    Args:
        input_path: Chemin vers le fichier DOCX source
        output_path: Chemin de destination pour le PDF (optionnel)
        timeout: Timeout en secondes pour la conversion

    Returns:
        Chemin vers le fichier PDF généré
    """
    if not input_path.exists():
        raise FileNotFoundError(f"Fichier source non trouvé: {input_path}")

    libreoffice_path = get_libreoffice_path()
    if not libreoffice_path:
        raise RuntimeError(
            "LibreOffice n'est pas installé. "
            "Installez libreoffice-writer-nogui pour la conversion DOCX vers PDF."
        )

    if output_path is None:
        output_path = input_path.with_suffix(".pdf")

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_dir_path = Path(temp_dir)

        cmd = [
            libreoffice_path,
            "--headless",
            "--convert-to", "pdf",
            "--outdir", str(temp_dir_path),
            str(input_path),
        ]

        logger.info(f"Conversion DOCX vers PDF (sync): {input_path.name}")

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=timeout,
            )

            if result.returncode != 0:
                error_msg = result.stderr.decode() if result.stderr else "Erreur inconnue"
                raise RuntimeError(
                    f"Échec de la conversion DOCX vers PDF: {error_msg}"
                )

            pdf_name = input_path.stem + ".pdf"
            temp_pdf_path = temp_dir_path / pdf_name

            if not temp_pdf_path.exists():
                raise RuntimeError(
                    f"Le fichier PDF n'a pas été généré: {pdf_name}"
                )

            shutil.move(str(temp_pdf_path), str(output_path))

            logger.info(f"Conversion réussie (sync): {output_path.name}")
            return output_path

        except subprocess.TimeoutExpired:
            raise RuntimeError(
                f"Timeout lors de la conversion DOCX vers PDF "
                f"(limite: {timeout}s)"
            )


def get_pdf_filename(original_filename: str) -> str:
    """
    Génère le nom du fichier PDF à partir du nom du fichier DOCX.

    Args:
        original_filename: Nom du fichier original (ex: "document.docx")

    Returns:
        Nom du fichier PDF (ex: "document.pdf")
    """
    return Path(original_filename).stem + ".pdf"


def get_pdf_mime_type() -> str:
    """Retourne le type MIME pour les fichiers PDF."""
    return "application/pdf"
