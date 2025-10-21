import asyncio
import sys
from io import BytesIO
from pathlib import Path

import pytest
from starlette.datastructures import UploadFile

from chatkit.store import NotFoundError
from chatkit.types import AttachmentCreateParams, FileAttachment

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.attachment_store import AttachmentUploadError, LocalAttachmentStore
from backend.app.chatkit_server.context import ChatKitRequestContext


class _StubStore:
    def __init__(self) -> None:
        self.attachments: dict[str, FileAttachment] = {}

    async def save_attachment(
        self, attachment: FileAttachment, context: ChatKitRequestContext
    ) -> None:
        self.attachments[attachment.id] = attachment

    async def load_attachment(
        self, attachment_id: str, context: ChatKitRequestContext
    ) -> FileAttachment:
        try:
            return self.attachments[attachment_id]
        except KeyError as exc:  # pragma: no cover - garde-fou
            raise NotFoundError("Pièce jointe introuvable") from exc

    async def delete_attachment(
        self, attachment_id: str, context: ChatKitRequestContext
    ) -> None:
        self.attachments.pop(attachment_id, None)


def test_create_and_finalize_attachment(tmp_path: Path) -> None:
    async def _run() -> None:
        store = _StubStore()
        attachment_store = LocalAttachmentStore(
            store, base_dir=tmp_path, default_base_url="http://test.local"
        )
        context = ChatKitRequestContext(user_id="user-1", email="user@example.com")
        params = AttachmentCreateParams(name="demo.txt", size=4, mime_type="text/plain")

        created = await attachment_store.create_attachment(params, context)
        assert created.upload_url is not None
        assert created.name == "demo.txt"

        upload = UploadFile(filename="demo.txt", file=BytesIO(b"data"))
        finalized = await attachment_store.finalize_upload(created.id, upload, context)
        assert finalized.upload_url is None

        user_dir = tmp_path / "user-1"
        stored_path = user_dir / f"{created.id}__demo.txt"
        assert stored_path.is_file()
        assert stored_path.read_bytes() == b"data"

        opened_path, mime_type, filename = await attachment_store.open_attachment(
            created.id, context
        )
        assert Path(opened_path) == stored_path
        assert mime_type == "text/plain"
        assert filename == "demo.txt"

        await attachment_store.delete_attachment(created.id, context)
        assert not stored_path.exists()

    asyncio.run(_run())


def test_finalize_upload_validates_size(tmp_path: Path) -> None:
    async def _run() -> None:
        store = _StubStore()
        attachment_store = LocalAttachmentStore(
            store, base_dir=tmp_path, default_base_url="http://test.local"
        )
        context = ChatKitRequestContext(user_id="user-99", email="size@example.com")
        params = AttachmentCreateParams(name="size.txt", size=10, mime_type="text/plain")

        created = await attachment_store.create_attachment(params, context)
        upload = UploadFile(filename="size.txt", file=BytesIO(b"small"))

        with pytest.raises(AttachmentUploadError):
            await attachment_store.finalize_upload(created.id, upload, context)

        user_dir = tmp_path / "user-99"
        stored_path = user_dir / f"{created.id}__size.txt"
        assert not stored_path.exists()

    asyncio.run(_run())
