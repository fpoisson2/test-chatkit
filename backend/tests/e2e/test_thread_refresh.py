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


if __name__ == "__main__":
    # Run tests directly with asyncio
    asyncio.run(test_thread_persists_after_refresh())
    asyncio.run(test_streaming_session_cleared_does_not_clear_thread_url())
    asyncio.run(test_react_strict_mode_double_mount())
