
import os
import time
from playwright.sync_api import sync_playwright

def verify_screencast_replacement():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # Port changed to 5183 as per log
        page.goto("http://localhost:5183")
        time.sleep(2)
        page.screenshot(path="verification/verification.png")
        browser.close()

if __name__ == "__main__":
    verify_screencast_replacement()
