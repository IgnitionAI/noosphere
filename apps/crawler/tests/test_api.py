"""Tests for crawler service API."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from crawler_service.main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


def test_health_check(client: TestClient):
    """Test health endpoint returns 200."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "crawler-service"


def test_start_crawl_invalid_url(client: TestClient):
    """Test starting crawl with invalid URL returns 422."""
    response = client.post(
        "/crawl",
        json={"url": "not-a-url", "limit": 5},
    )
    assert response.status_code == 422


def test_get_nonexistent_job(client: TestClient):
    """Test getting status of non-existent job returns 404."""
    response = client.get("/crawl/nonexistent-id")
    assert response.status_code == 404


def test_delete_nonexistent_job(client: TestClient):
    """Test deleting non-existent job returns 404."""
    response = client.delete("/crawl/nonexistent-id")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_start_crawl_valid_url(client: TestClient, monkeypatch):
    """Test starting crawl with valid URL.

    execute_crawl is faked: a real crawl launches a browser and always
    outlives the request, so it gets cancelled during TestClient portal
    teardown — where browser cleanup hangs (environment-dependent). What this
    test asserts is route/job/cancel behaviour, not crawling itself.
    """

    async def fake_execute_crawl(job):
        await asyncio.sleep(0.05)

    monkeypatch.setattr(
        "crawler_service.api.routes.execute_crawl", fake_execute_crawl
    )

    response = client.post(
        "/crawl",
        json={"url": "https://example.com", "limit": 1},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert "id" in data

    # Cancel the job to clean up
    job_id = data["id"]
    client.delete(f"/crawl/{job_id}")
