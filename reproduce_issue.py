import asyncio
import os
import sys
import logging
from datetime import datetime

# Setup paths
sys.path.append(os.path.join(os.getcwd(), "backend/app"))
sys.path.append(os.path.join(os.getcwd(), "chatkit-python"))

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("reproduce")

# Mock environment variables needed for backend imports
os.environ["OPENAI_API_KEY"] = "sk-mock-key"
os.environ["AUTH_SECRET_KEY"] = "mock-secret-key"
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

# Import necessary modules
from chatkit.types import (
    ThreadsCreateReq,
    UserMessageInput,
    UserMessageTextContent,
    InferenceOptions,
    ThreadsResumeReq,
    ThreadResumeParams,
    ThreadCreateParams,
    ThreadStreamEvent
)
from chatkit.server import ChatKitServer
from chatkit_server.server import DemoChatKitServer
from chatkit_server.context import ChatKitRequestContext
from chatkit.store import Store
from agents import Agent

# Mock context
class MockContext(ChatKitRequestContext):
    def __init__(self):
        pass
    def trace_metadata(self):
        return {}

async def main():
    logger.info("Starting reproduction script...")

    # 1. Initialize Server
    from config import Settings
    settings = Settings(
        openai_api_key="mock",
        auth_secret_key="mock",
        database_url="sqlite:///./test.db"
    )

    # Mock the run_workflow to simulate a long running process
    async def mock_run_workflow(*args, **kwargs):
        on_stream_event = kwargs.get('on_stream_event')

        # Simulate some initial events
        from chatkit.types import ProgressUpdateEvent, AssistantMessageContentPartTextDelta, ThreadItemUpdated

        logger.info("Mock workflow started")

        # Send some progress
        await on_stream_event(ProgressUpdateEvent(text="Step 1..."))
        await asyncio.sleep(1) # Simulate work

        # Send more progress
        await on_stream_event(ProgressUpdateEvent(text="Step 2..."))
        await asyncio.sleep(1) # Simulate work

        logger.info("Mock workflow finished")
        return None # Return summary mock if needed

    # Patch the server's _run_workflow
    server = DemoChatKitServer(settings=settings)
    server._run_workflow = mock_run_workflow

    context = MockContext()

    # 2. Create a thread and start streaming
    logger.info("Creating thread...")
    create_req = ThreadsCreateReq(
        params=ThreadCreateParams(
            input=UserMessageInput(
                content=[UserMessageTextContent(text="Hello")],
                attachments=[],
                inference_options=InferenceOptions()
            )
        )
    )

    thread_id = None

    # Process creation stream partially
    logger.info("Starting stream...")
    iterator = server._process_streaming_impl(create_req, context)

    count = 0
    async for event in iterator:
        if event.type == "thread.created":
            thread_id = event.thread.id
            logger.info(f"Thread created: {thread_id}")

        logger.info(f"Received event: {event.type}")
        count += 1

        # Simulate disconnect after a few events
        if count >= 3:
            logger.info("Simulating disconnect...")
            break

    # 3. Simulate Resume
    logger.info(f"Resuming stream for thread {thread_id}...")
    resume_req = ThreadsResumeReq(
        params=ThreadResumeParams(thread_id=thread_id)
    )

    resume_iterator = server._process_streaming_impl(resume_req, context)

    resumed_events = 0
    async for event in resume_iterator:
        logger.info(f"Resumed event: {event.type}")
        resumed_events += 1

    if resumed_events > 0:
        logger.info("SUCCESS: Stream resumed and received events.")
    else:
        logger.error("FAILURE: Stream resumed but received no events.")

if __name__ == "__main__":
    asyncio.run(main())
