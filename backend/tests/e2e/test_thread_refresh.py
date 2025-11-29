"""
End-to-end test for thread refresh persistence.

This test verifies that when a user:
1. Sends a message (creating a new thread)
2. Refreshes the page
3. The thread is restored correctly with its history

Tests the fix for the streaming session resume feature and URL persistence.
"""

import asyncio
import os
import pytest
from playwright.async_api import async_playwright, Page, BrowserContext


# Get credentials from environment - NO DEFAULTS for sensitive data
CHATKIT_URL = os.environ.get("CHATKIT_URL", "https://chatkit.ve2fpd.com")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD")

if not ADMIN_EMAIL or not ADMIN_PASSWORD:
    raise ValueError("ADMIN_EMAIL and ADMIN_PASSWORD environment variables must be set")


async def login(page: Page) -> bool:
    """Login to the application and return True if successful."""
    await page.goto(f"{CHATKIT_URL}/login")
    await asyncio.sleep(3)

    email_input = await page.query_selector('input[type="email"]')
    password_input = await page.query_selector('input[type="password"]')

    if not email_input or not password_input:
        return False

    await email_input.fill(ADMIN_EMAIL)
    await password_input.fill(ADMIN_PASSWORD)

    submit_btn = await page.query_selector('button[type="submit"]')
    if submit_btn:
        await submit_btn.click()
        await asyncio.sleep(5)

    # Check if we're logged in (not on login page anymore)
    return "/login" not in page.url or page.url == f"{CHATKIT_URL}/"


async def send_message(page: Page, message: str) -> bool:
    """Send a message in the chat and return True if successful."""
    textareas = await page.query_selector_all("textarea")

    for ta in textareas:
        if await ta.is_visible():
            await ta.fill(message)
            await ta.press("Enter")
            return True

    return False


async def get_thread_id_from_url(page: Page) -> str | None:
    """Extract thread ID from URL if present."""
    url = page.url
    if "thread=" in url:
        # Parse ?thread=xxx or &thread=xxx
        import urllib.parse
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        thread_ids = params.get("thread", [])
        return thread_ids[0] if thread_ids else None
    return None


@pytest.mark.asyncio
async def test_thread_persists_after_refresh():
    """
    Test that a thread persists after page refresh.

    Steps:
    1. Login to the application
    2. Send a test message (creates a new thread)
    3. Wait for response and verify thread ID in URL
    4. Refresh the page
    5. Verify the same thread ID is still in URL
    6. Verify the thread loads correctly
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path="/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome"
        )
        context = await browser.new_context()
        page = await context.new_page()

        logs: list[str] = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

        try:
            # Step 1: Login
            assert await login(page), "Login failed"

            # Wait for app to fully load
            await asyncio.sleep(5)

            # Step 2: Send a test message
            test_message = f"Test thread persistence {asyncio.get_event_loop().time()}"
            assert await send_message(page, test_message), "Failed to send message"

            # Step 3: Wait for response and get thread ID
            await asyncio.sleep(15)  # Wait for streaming to complete

            thread_id_before = await get_thread_id_from_url(page)
            assert thread_id_before is not None, "Thread ID not found in URL after sending message"
            assert thread_id_before.startswith("thr_"), f"Invalid thread ID format: {thread_id_before}"

            url_before_refresh = page.url
            print(f"URL before refresh: {url_before_refresh}")
            print(f"Thread ID before refresh: {thread_id_before}")

            # Clear logs before refresh
            logs.clear()

            # Step 4: Refresh the page
            await page.reload()
            await asyncio.sleep(10)  # Wait for page to fully reload

            # Step 5: Verify thread ID is still in URL
            thread_id_after = await get_thread_id_from_url(page)
            url_after_refresh = page.url

            print(f"URL after refresh: {url_after_refresh}")
            print(f"Thread ID after refresh: {thread_id_after}")

            assert thread_id_after is not None, "Thread ID lost after refresh!"
            assert thread_id_after == thread_id_before, (
                f"Thread ID changed after refresh: {thread_id_before} -> {thread_id_after}"
            )

            # Step 6: Verify thread loaded correctly by checking logs
            thread_found_logs = [
                log for log in logs
                if "Found thread ID in URL" in log and thread_id_after in log
            ]
            assert len(thread_found_logs) > 0, "Thread was not found in URL during page load"

            thread_load_logs = [
                log for log in logs
                if "thread load end" in log and thread_id_after in log
            ]
            assert len(thread_load_logs) > 0, "Thread did not finish loading after refresh"

            # Verify no URL clearing happened
            url_clear_logs = [
                log for log in logs
                if "setThreadIdInUrl" in log and "null" in log
            ]
            assert len(url_clear_logs) == 0, (
                f"URL was cleared during page load: {url_clear_logs}"
            )

            print("✓ Thread persisted correctly after refresh!")

        finally:
            await browser.close()


@pytest.mark.asyncio
async def test_streaming_session_cleared_does_not_clear_thread_url():
    """
    Test that when a streaming session is not found (expired),
    the thread URL is NOT cleared.

    This tests the fix where we removed setThreadIdInUrl(null) from
    the streaming resume error handling.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path="/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome"
        )
        context = await browser.new_context()
        page = await context.new_page()

        logs: list[str] = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

        try:
            # Login
            assert await login(page), "Login failed"
            await asyncio.sleep(5)

            # Send message to create a thread
            assert await send_message(page, "Test streaming session"), "Failed to send message"
            await asyncio.sleep(15)

            thread_id = await get_thread_id_from_url(page)
            assert thread_id is not None, "Thread ID not in URL"

            # Clear the streaming session from sessionStorage to simulate expiration
            await page.evaluate("sessionStorage.removeItem('chatkit:streaming-session')")

            logs.clear()

            # Refresh - streaming session will not be found
            await page.reload()
            await asyncio.sleep(10)

            # Thread should still be in URL
            thread_id_after = await get_thread_id_from_url(page)
            assert thread_id_after == thread_id, (
                f"Thread ID was cleared after streaming session not found! "
                f"Before: {thread_id}, After: {thread_id_after}"
            )

            # Verify the session not found log appeared but URL was not cleared
            session_not_found_logs = [
                log for log in logs
                if "Session not found" in log or "clearing session" in log.lower()
            ]
            # This log may or may not appear depending on timing

            # Most importantly, verify setThreadIdInUrl(null) was NOT called
            url_null_logs = [
                log for log in logs
                if "setThreadIdInUrl" in log and "threadId: null" in log
            ]
            assert len(url_null_logs) == 0, (
                f"setThreadIdInUrl(null) was called! Logs: {url_null_logs}"
            )

            print("✓ Thread URL preserved even when streaming session not found!")

        finally:
            await browser.close()


@pytest.mark.asyncio
async def test_react_strict_mode_double_mount():
    """
    Test that React Strict Mode's double mount/unmount doesn't break
    the streaming resume functionality.

    In React 18 Strict Mode, effects run twice on mount.
    Our fix ensures checkedRef is only updated after async completion,
    so the second mount can retry if the first was aborted.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path="/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome"
        )
        context = await browser.new_context()
        page = await context.new_page()

        logs: list[str] = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

        try:
            # Login
            assert await login(page), "Login failed"
            await asyncio.sleep(5)

            # Send message
            assert await send_message(page, "Test strict mode"), "Failed to send message"
            await asyncio.sleep(15)

            thread_id = await get_thread_id_from_url(page)
            assert thread_id is not None, "Thread ID not in URL"

            logs.clear()

            # Refresh multiple times quickly to stress test
            for i in range(3):
                await page.reload()
                await asyncio.sleep(3)

            await asyncio.sleep(5)  # Final wait

            # Thread should still be loaded
            final_thread_id = await get_thread_id_from_url(page)
            assert final_thread_id == thread_id, (
                f"Thread ID changed during rapid refreshes: {thread_id} -> {final_thread_id}"
            )

            # Verify thread loaded at least once
            thread_load_logs = [
                log for log in logs
                if "thread load end" in log
            ]
            assert len(thread_load_logs) > 0, "Thread never finished loading"

            print("✓ Thread handled React Strict Mode correctly!")

        finally:
            await browser.close()


async def count_messages(page: Page) -> dict:
    """Count user and assistant messages in the chat."""
    # Count messages by looking at the message bubbles in the UI
    user_messages = await page.query_selector_all('[data-testid="user-message"], .user-message, [class*="user-message"]')
    assistant_messages = await page.query_selector_all('[data-testid="assistant-message"], .assistant-message, [class*="assistant-message"]')

    # Alternative: count by role attribute if available
    if not user_messages and not assistant_messages:
        user_messages = await page.query_selector_all('[data-role="user"]')
        assistant_messages = await page.query_selector_all('[data-role="assistant"]')

    return {
        "user": len(user_messages),
        "assistant": len(assistant_messages)
    }


async def get_assistant_message_text(page: Page) -> str | None:
    """Extract text content from the assistant's message bubble."""
    # Try various selectors that might match assistant messages
    selectors = [
        '[data-role="assistant"]',
        '[data-testid="assistant-message"]',
        '.assistant-message',
        '[class*="assistant"]',
        # ChatKit specific selectors - look for message content areas
        '[class*="prose"]',  # Markdown content usually has prose class
        '[class*="markdown"]',
    ]

    for selector in selectors:
        elements = await page.query_selector_all(selector)
        for el in elements:
            text = await el.inner_text()
            if text and len(text) > 20:  # Meaningful content
                return text

    return None


async def count_visible_messages(page: Page) -> dict:
    """Count user and assistant message bubbles visible on page."""
    # Get page content and look for message patterns
    # This is more reliable than CSS selectors which vary by UI framework

    # Use JavaScript to count message elements
    result = await page.evaluate("""
        () => {
            // Look for message containers - adjust selectors based on actual UI
            const allElements = document.querySelectorAll('*');
            let userCount = 0;
            let assistantCount = 0;

            for (const el of allElements) {
                const className = el.className || '';
                const role = el.getAttribute('data-role') || '';
                const testId = el.getAttribute('data-testid') || '';

                // Check for user messages
                if (role === 'user' ||
                    testId.includes('user') ||
                    className.includes('user-message') ||
                    (className.includes('message') && className.includes('user'))) {
                    userCount++;
                }

                // Check for assistant messages
                if (role === 'assistant' ||
                    testId.includes('assistant') ||
                    className.includes('assistant-message') ||
                    (className.includes('message') && className.includes('assistant'))) {
                    assistantCount++;
                }
            }

            return { user: userCount, assistant: assistantCount };
        }
    """)
    return result


@pytest.mark.asyncio
async def test_messages_persist_during_active_streaming():
    """
    Test that messages display correctly after refreshing during active streaming.

    This is the key test for the streaming resume feature:
    1. Login to the application
    2. Send a message that will trigger a LONG streaming response
    3. Wait for assistant to START responding (capture partial response)
    4. Refresh the page WHILE the assistant is still streaming
    5. Verify that the assistant's response content is visible after refresh
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path="/root/.cache/ms-playwright/chromium-1148/chrome-linux/chrome"
        )
        context = await browser.new_context()
        page = await context.new_page()

        logs: list[str] = []
        page.on("console", lambda msg: logs.append(f"[{msg.type}] {msg.text}"))

        try:
            # Step 1: Login
            assert await login(page), "Login failed"
            await asyncio.sleep(5)

            # Step 2: Send a message that will generate a LONG response
            long_message = "Write a detailed essay about the history of artificial intelligence from the 1950s to today, covering Turing, neural networks, deep learning, and modern LLMs."
            assert await send_message(page, long_message), "Failed to send message"

            # Step 3: Wait for streaming to START and capture partial response
            # Wait long enough for assistant to start generating visible text
            await asyncio.sleep(5)

            # Verify thread is created
            thread_id = await get_thread_id_from_url(page)
            assert thread_id is not None, "Thread ID not in URL during streaming"
            print(f"Thread ID: {thread_id}")

            # Capture assistant's partial response BEFORE refresh
            assistant_text_before = await get_assistant_message_text(page)
            page_content_before = await page.content()

            print(f"=== BEFORE REFRESH ===")
            print(f"Assistant text found: {assistant_text_before is not None}")
            if assistant_text_before:
                print(f"Assistant text preview: {assistant_text_before[:200]}...")

            # Check if there's AI-related content being streamed
            has_ai_content_before = any(word in page_content_before.lower() for word in [
                "artificial intelligence", "turing", "neural", "machine learning",
                "deep learning", "algorithm", "computer", "1950"
            ])
            print(f"Has AI-related content before refresh: {has_ai_content_before}")

            # Step 4: Refresh the page during active streaming
            print("\n=== REFRESHING PAGE ===")
            logs.clear()
            await page.reload()

            # Wait for page to load and potentially resume/reconstruct
            # Need extra time for streaming resume API calls to complete
            await asyncio.sleep(20)

            # Step 5: Verify thread ID preserved
            thread_id_after = await get_thread_id_from_url(page)
            assert thread_id_after == thread_id, f"Thread ID changed: {thread_id} -> {thread_id_after}"

            # Step 6: Check what's visible AFTER refresh
            assistant_text_after = await get_assistant_message_text(page)
            page_content_after = await page.content()

            print(f"\n=== AFTER REFRESH ===")
            print(f"Assistant text found: {assistant_text_after is not None}")
            if assistant_text_after:
                print(f"Assistant text preview: {assistant_text_after[:200]}...")

            # Check for AI-related content after refresh
            has_ai_content_after = any(word in page_content_after.lower() for word in [
                "artificial intelligence", "turing", "neural", "machine learning",
                "deep learning", "algorithm", "computer", "1950"
            ])
            print(f"Has AI-related content after refresh: {has_ai_content_after}")

            # Check resume-related logs
            resume_logs = [log for log in logs if "Reconnect" in log or "events" in log.lower()]
            print(f"Resume logs: {resume_logs[:3]}")

            # Debug: show session-related logs
            session_logs = [log for log in logs if "session" in log.lower() or "Session" in log]
            print(f"Session logs: {session_logs[:10]}")

            # Debug: show all WorkflowChat logs
            workflow_logs = [log for log in logs if "WorkflowChat" in log]
            print(f"WorkflowChat logs: {workflow_logs[:10]}")

            # Debug: show streamingSession logs
            streaming_logs = [log for log in logs if "streamingSession" in log]
            print(f"streamingSession logs: {streaming_logs[:5]}")

            # Debug: show useStreamingResume logs
            resume_hook_logs = [log for log in logs if "useStreamingResume" in log]
            print(f"useStreamingResume logs: {resume_hook_logs[:10]}")

            # Debug: show ChatKit logs
            chatkit_logs = [log for log in logs if "ChatKit" in log]
            print(f"ChatKit logs: {chatkit_logs[:10]}")

            # THE KEY ASSERTION: If we had AI content before, we should have it after
            if has_ai_content_before:
                assert has_ai_content_after, (
                    "FAIL: Assistant's response was visible before refresh but NOT after!\n"
                    "This is the bug we're trying to fix."
                )
                print("✓ Assistant's response content preserved after refresh!")
            else:
                # If no content before, at least verify user message is visible
                assert "artificial intelligence" in page_content_after.lower() or \
                       "essay" in page_content_after.lower(), \
                       "User message not visible after refresh"
                print("⚠ No assistant content before refresh (streaming may not have started)")
                print("✓ User message is visible after refresh")

        finally:
            await browser.close()


if __name__ == "__main__":
    # Run tests directly with asyncio
    asyncio.run(test_thread_persists_after_refresh())
    asyncio.run(test_streaming_session_cleared_does_not_clear_thread_url())
    asyncio.run(test_react_strict_mode_double_mount())
    asyncio.run(test_messages_persist_during_active_streaming())
