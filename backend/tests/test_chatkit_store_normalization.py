
import pytest
from app.chatkit_store import PostgresChatKitStore

def test_normalize_text_block_safely_handles_math_expressions():
    """
    Verifies that _normalize_text_block does not incorrectly strip text
    that looks like HTML tags but is actually mathematical expressions.
    """
    # Case 1: Mathematical expression with < and >
    text = "1 < 2 and 3 > 2"
    normalized = PostgresChatKitStore._normalize_text_block(text)
    assert normalized == text, f"Expected '{text}', but got '{normalized}'"

def test_normalize_text_block_handles_legacy_html():
    """
    Verifies that _normalize_text_block still handles the legacy HTML it was designed for.
    """
    # Case 2: Actual HTML should still be processed
    # <p>Hello</p><br>World -> Hello\nWorld
    html_text = "<p>Hello</p><br>World"
    expected = "Hello\nWorld"
    normalized = PostgresChatKitStore._normalize_text_block(html_text)
    assert normalized == expected

    html_text_paragraphs = "<p>Paragraph 1</p><p>Paragraph 2</p>"
    # </p><p> -> \n\n
    # <p>Paragraph 1\n\nParagraph 2</p>
    # remove <p>, </p>
    # Paragraph 1\n\nParagraph 2

    expected_paragraphs = "Paragraph 1\n\nParagraph 2"
    normalized_paragraphs = PostgresChatKitStore._normalize_text_block(html_text_paragraphs)
    assert normalized_paragraphs == expected_paragraphs

    code_html = "<pre><code class=\"language-python\">print('hello')</code></pre>"
    expected_code = "\n```python\nprint('hello')\n```\n"
    normalized_code = PostgresChatKitStore._normalize_text_block(code_html)
    assert normalized_code == expected_code

def test_normalize_text_block_handles_mixed_content():
    """
    Verifies that mixed content (math + HTML) is handled gracefully.
    """
    text = "1 < 2 <br> 3"
    # <br> should be replaced by \n. < 2 should be preserved.
    expected = "1 < 2 \n 3"
    normalized = PostgresChatKitStore._normalize_text_block(text)
    assert normalized == expected
