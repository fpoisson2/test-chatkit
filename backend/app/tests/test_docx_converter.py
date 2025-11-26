"""
Tests pour le module de conversion DOCX vers PDF.
"""

import shutil
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.docx_converter import (
    DOCX_EXTENSIONS,
    DOCX_MIME_TYPES,
    convert_docx_to_pdf,
    convert_docx_to_pdf_sync,
    get_libreoffice_path,
    get_pdf_filename,
    get_pdf_mime_type,
    is_docx_file,
)


class TestIsDocxFile:
    """Tests pour la détection des fichiers DOCX."""

    def test_docx_extension(self):
        """Détecte les fichiers .docx par extension."""
        assert is_docx_file("document.docx") is True
        assert is_docx_file("DOCUMENT.DOCX") is True
        assert is_docx_file("my.file.docx") is True

    def test_doc_extension(self):
        """Détecte les fichiers .doc par extension."""
        assert is_docx_file("document.doc") is True
        assert is_docx_file("DOCUMENT.DOC") is True

    def test_non_docx_extension(self):
        """Rejette les fichiers non-DOCX."""
        assert is_docx_file("document.pdf") is False
        assert is_docx_file("document.txt") is False
        assert is_docx_file("document.xlsx") is False

    def test_docx_mime_type(self):
        """Détecte les fichiers DOCX par type MIME."""
        assert is_docx_file(
            "file",
            mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ) is True
        assert is_docx_file("file", mime_type="application/msword") is True

    def test_non_docx_mime_type(self):
        """Rejette les types MIME non-DOCX."""
        assert is_docx_file("file", mime_type="application/pdf") is False
        assert is_docx_file("file", mime_type="text/plain") is False


class TestGetPdfFilename:
    """Tests pour la génération du nom de fichier PDF."""

    def test_docx_to_pdf(self):
        """Convertit .docx en .pdf."""
        assert get_pdf_filename("document.docx") == "document.pdf"

    def test_doc_to_pdf(self):
        """Convertit .doc en .pdf."""
        assert get_pdf_filename("document.doc") == "document.pdf"

    def test_complex_filename(self):
        """Gère les noms de fichiers complexes."""
        assert get_pdf_filename("my.complex.document.docx") == "my.complex.document.pdf"

    def test_no_extension(self):
        """Gère les fichiers sans extension."""
        assert get_pdf_filename("document") == "document.pdf"


class TestGetPdfMimeType:
    """Tests pour le type MIME PDF."""

    def test_returns_pdf_mime_type(self):
        """Retourne le type MIME PDF correct."""
        assert get_pdf_mime_type() == "application/pdf"


class TestGetLibreOfficePath:
    """Tests pour la détection du chemin LibreOffice."""

    def test_finds_libreoffice(self):
        """Trouve LibreOffice si installé."""
        with patch("shutil.which") as mock_which:
            mock_which.side_effect = lambda x: "/usr/bin/libreoffice" if x == "libreoffice" else None
            path = get_libreoffice_path()
            assert path == "libreoffice"

    def test_finds_soffice(self):
        """Trouve soffice si libreoffice n'est pas disponible."""
        with patch("shutil.which") as mock_which:
            mock_which.side_effect = lambda x: "/usr/bin/soffice" if x == "soffice" else None
            path = get_libreoffice_path()
            assert path == "soffice"

    def test_returns_none_if_not_found(self):
        """Retourne None si LibreOffice n'est pas installé."""
        with patch("shutil.which", return_value=None):
            path = get_libreoffice_path()
            assert path is None


class TestConvertDocxToPdfSync:
    """Tests pour la conversion synchrone DOCX vers PDF."""

    def test_file_not_found(self):
        """Lève une erreur si le fichier source n'existe pas."""
        with pytest.raises(FileNotFoundError, match="Fichier source non trouvé"):
            convert_docx_to_pdf_sync(Path("/nonexistent/file.docx"))

    def test_libreoffice_not_installed(self):
        """Lève une erreur si LibreOffice n'est pas installé."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            temp_path = Path(f.name)
            try:
                with patch("app.docx_converter.get_libreoffice_path", return_value=None):
                    with pytest.raises(RuntimeError, match="LibreOffice n'est pas installé"):
                        convert_docx_to_pdf_sync(temp_path)
            finally:
                temp_path.unlink(missing_ok=True)


@pytest.mark.asyncio
class TestConvertDocxToPdfAsync:
    """Tests pour la conversion asynchrone DOCX vers PDF."""

    async def test_file_not_found(self):
        """Lève une erreur si le fichier source n'existe pas."""
        with pytest.raises(FileNotFoundError, match="Fichier source non trouvé"):
            await convert_docx_to_pdf(Path("/nonexistent/file.docx"))

    async def test_libreoffice_not_installed(self):
        """Lève une erreur si LibreOffice n'est pas installé."""
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as f:
            temp_path = Path(f.name)
            try:
                with patch("app.docx_converter.get_libreoffice_path", return_value=None):
                    with pytest.raises(RuntimeError, match="LibreOffice n'est pas installé"):
                        await convert_docx_to_pdf(temp_path)
            finally:
                temp_path.unlink(missing_ok=True)


class TestDocxConstants:
    """Tests pour les constantes du module."""

    def test_docx_extensions(self):
        """Vérifie les extensions DOCX supportées."""
        assert ".docx" in DOCX_EXTENSIONS
        assert ".doc" in DOCX_EXTENSIONS

    def test_docx_mime_types(self):
        """Vérifie les types MIME DOCX supportés."""
        assert "application/vnd.openxmlformats-officedocument.wordprocessingml.document" in DOCX_MIME_TYPES
        assert "application/msword" in DOCX_MIME_TYPES
