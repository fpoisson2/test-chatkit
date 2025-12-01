from playwright.sync_api import Page, expect, sync_playwright

def verify_logo(page: Page):
    # Go to landing page
    page.goto("http://localhost:5183/")

    # Check for text "EDxo" in the header logo area
    # In LandingPage.tsx, it's inside <div class="logo"> ... <span>EDxo</span>
    # We can look for text "EDxo" and the logo image

    # Wait for the logo text to be visible
    logo_text = page.locator("nav").get_by_text("EDxo", exact=True)
    expect(logo_text).to_be_visible()

    # Check for the image
    logo_img = page.locator("nav img[alt='EDxo']")
    expect(logo_img).to_be_visible()

    # Take screenshot of the header
    page.screenshot(path="verification/landing_page_header.png")
    print("Screenshot saved to verification/landing_page_header.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_logo(page)
        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error_screenshot.png")
        finally:
            browser.close()
