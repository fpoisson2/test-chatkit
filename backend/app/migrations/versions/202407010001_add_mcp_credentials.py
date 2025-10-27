"""add MCP credential storage"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "202407010001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mcp_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("label", sa.String(length=128), nullable=False),
        sa.Column("provider", sa.String(length=128), nullable=True),
        sa.Column("auth_type", sa.String(length=32), nullable=False),
        sa.Column("secret_hint", sa.String(length=128), nullable=True),
        sa.Column("encrypted_payload", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )


def downgrade() -> None:
    op.drop_table("mcp_credentials")
