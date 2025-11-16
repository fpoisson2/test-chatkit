import json
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "chatkit-python"))
sys.modules.pop("agents", None)
sys.modules.pop("agents.mcp", None)

from app.workflows.template_utils import render_agent_instructions  # noqa: E402


def test_render_agent_instructions_handles_state_values() -> None:
    state = {"last_generated_image_urls": ["http://image-one", "http://image-two"]}

    rendered = render_agent_instructions(
        "{{ state.last_generated_image_urls }}",
        state=state,
        last_step_context=None,
        run_context=None,
    )

    expected = json.dumps(state["last_generated_image_urls"], ensure_ascii=False)

    assert rendered == expected


def test_render_agent_instructions_supports_unprefixed_state_identifier() -> None:
    state = {"last_generated_image_urls": ["https://image"]}

    rendered = render_agent_instructions(
        "Afficher : {{ last_generated_image_urls }}",
        state=state,
        last_step_context=None,
        run_context=None,
    )

    assert rendered == "Afficher : [\"https://image\"]"
