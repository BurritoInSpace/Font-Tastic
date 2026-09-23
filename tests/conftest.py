import pytest


@pytest.fixture(autouse=True)
def isolated_config(tmp_path_factory, monkeypatch):
    """Keep the recent-projects list out of the real user profile."""
    monkeypatch.setenv("FONTTASTIC_CONFIG_DIR", str(tmp_path_factory.mktemp("config")))
