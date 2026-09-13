import os
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("IPD_SMOKE_BASE_URL", "http://127.0.0.1:5173")
FORBIDDEN = re.compile(r"bearerToken|bms_session_code|marketplace-token|HN\s*[:#-]?\s*\d{6,}|AN\s*[:#-]?\s*\d{6,}", re.I)


def main() -> None:
    Path("test-results").mkdir(exist_ok=True)
    console_messages: list[str] = []
    network_secrets: list[str] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.on("console", lambda message: console_messages.append(message.text))

        def inspect_request(request) -> None:
            payload = request.post_data or ""
            value = f"{request.url} {payload}"
            if FORBIDDEN.search(value):
                network_secrets.append(value)

        page.on("request", inspect_request)
        page.goto(BASE_URL, wait_until="networkidle")
        page.get_by_role("button", name=re.compile("AN-DEMO-001")).wait_for()
        page.get_by_role("heading", name="DRG audit").wait_for()
        page.get_by_text("Version fence").wait_for()

        storage = page.evaluate("""() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })""")
        assert storage == {"local": [], "session": []}, storage
        assert "AN-DEMO-001" not in page.url
        assert not any(FORBIDDEN.search(message) for message in console_messages), console_messages
        assert not network_secrets, network_secrets
        page.screenshot(path="test-results/ipd-summary-smoke.png", full_page=True)
        browser.close()
    print("browser smoke passed")


if __name__ == "__main__":
    main()
