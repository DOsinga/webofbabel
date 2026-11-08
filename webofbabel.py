import json
import os

import httpx
from django.http import (
    HttpResponseBadRequest,
    HttpResponseNotAllowed,
    JsonResponse,
    StreamingHttpResponse,
)

from projects.common import Project


OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODEL = "deepseek/deepseek-v4.1-flash-1017"
SYSTEM_PROMPT = """You are the internet. When given a URL, generate a complete, plausible HTML page that could exist at that address. Output ONLY raw HTML (starting with <!DOCTYPE html> or <html>). No markdown, no code fences, no explanation.

Guidelines:
- Make the page look convincing and feel like a real website at that URL
- Include realistic content, navigation, styling — the more specific and detailed the better
- Lean into hallucination: invent plausible content, people, articles, products
- Include several clickable <a href="..."> links to other pages, using full absolute URLs, so the user can keep browsing
- Use inline <style> tags for CSS and make it look like a real website
- If the URL suggests a specific era or style, match it
- Keep the HTML self-contained, with inline styles and scripts and no external resources
- Include a fitting favicon as an inline SVG data URI
- Be creative and surprising. The pages should feel alive."""


def build_prompt(payload):
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object")
    url = payload.get("url")
    if not isinstance(url, str) or not url.strip():
        raise ValueError("URL is required")
    if len(url) > 2_000:
        raise ValueError("URL is too long")

    prompt = f"URL: {url.strip()}"
    link_text = payload.get("linkText")
    if link_text:
        prompt += f'\nThe user clicked a link with text: "{str(link_text)[:500]}"'

    form_data = payload.get("formData")
    if form_data:
        if not isinstance(form_data, dict):
            raise ValueError("Form data must be an object")
        fields = "\n".join(
            f"  {str(key)[:200]}: {str(value)[:1_000]}"
            for key, value in list(form_data.items())[:50]
        )
        prompt += f"\nThe user submitted a form with the following data:\n{fields}"

    return prompt + "\n\nGenerate the full HTML page for this URL."


def error_event(message):
    return f"data: {json.dumps({'error': {'message': message}})}\n\n".encode()


async def stream_page(prompt, api_key, model):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://douwe.com/projects/webofbabel",
        "X-Title": "The Web of Babel",
    }
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "stream": True,
        "max_tokens": 16_000,
        "reasoning_effort": "low",
    }

    try:
        timeout = httpx.Timeout(180, connect=15)
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST", OPENROUTER_URL, headers=headers, json=payload
            ) as response:
                if response.is_error:
                    body = (await response.aread()).decode(errors="replace")
                    try:
                        detail = json.loads(body).get("error", {}).get("message", body)
                    except json.JSONDecodeError:
                        detail = body
                    yield error_event(
                        f"OpenRouter API error {response.status_code}: {detail}"
                    )
                    return

                async for chunk in response.aiter_bytes():
                    yield chunk
    except httpx.HTTPError as error:
        yield error_event(f"OpenRouter request failed: {error}")


class WebOfBabel(Project):
    def get_embed_tag(self):
        return None

    def handle_request(self, handler, request):
        if handler != "api/generate":
            return None
        if request.method != "POST":
            return HttpResponseNotAllowed(["POST"])
        if len(request.body) > 64_000:
            return HttpResponseBadRequest("Request is too large")

        try:
            payload = json.loads(request.body)
            prompt = build_prompt(payload)
        except (json.JSONDecodeError, TypeError, ValueError) as error:
            return HttpResponseBadRequest(str(error))

        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            return JsonResponse(
                {"error": "OPENROUTER_API_KEY is not configured"}, status=503
            )

        model = os.environ.get("WEBOFBABEL_MODEL", DEFAULT_MODEL)
        response = StreamingHttpResponse(
            stream_page(prompt, api_key, model), content_type="text/event-stream"
        )
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response
