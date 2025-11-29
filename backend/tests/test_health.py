
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import MagicMock, AsyncMock, patch

from app import app

@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    """Test the health check endpoint."""

    # We mock the database session execute to return successfully
    with patch("app.routes.health.get_session") as mock_get_session:
        # Mock Redis
        with patch("app.routes.health.from_url") as mock_from_url:
            mock_redis = AsyncMock()
            mock_from_url.return_value.__aenter__.return_value = mock_redis

            response = await client.get("/health/")

            assert response.status_code == 200
            data = response.json()
            assert "status" in data
            assert "components" in data
            assert "database" in data["components"]
            assert "redis" in data["components"]

@pytest.mark.asyncio
async def test_health_check_structure(client: AsyncClient):
    """
    Test that the health check endpoint returns the correct structure.
    Even if services are down, it should return a JSON response.
    """
    # Since we are not mocking DB here, it might fail or return error status, but structure should be correct
    # However, get_session might fail if DB is not configured.
    # So we should probably mock get_session here as well or expect 500 if DB not connected

    with patch("app.routes.health.get_session"):
        response = await client.get("/health/")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "components" in data
