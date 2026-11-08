import json
import os
from unittest.mock import Mock, patch

from django.http import StreamingHttpResponse
from django.test import RequestFactory, SimpleTestCase

from projects.webofbabel.webofbabel import WebOfBabel, build_prompt


class WebOfBabelTest(SimpleTestCase):
    def setUp(self):
        self.project = WebOfBabel("webofbabel", "The Web of Babel", "Imagined web")
        self.factory = RequestFactory()

    def test_prompt_includes_navigation_context(self):
        prompt = build_prompt(
            {
                "url": "https://example.test/search",
                "linkText": "Find the lost city",
                "formData": {"query": "Atlantis"},
            }
        )

        self.assertIn("URL: https://example.test/search", prompt)
        self.assertIn("Find the lost city", prompt)
        self.assertIn("query: Atlantis", prompt)

    @patch.dict(os.environ, {}, clear=True)
    def test_generation_requires_server_key(self):
        request = self.factory.post(
            "/projects/webofbabel/api/generate",
            data=json.dumps({"url": "https://example.test"}),
            content_type="application/json",
        )

        response = self.project.handle_request("api/generate", request)

        self.assertEqual(response.status_code, 503)
        self.assertNotIn("api_key", response.content.decode())

    @patch.dict(
        os.environ,
        {"OPENROUTER_API_KEY": "secret", "WEBOFBABEL_MODEL": "test/model"},
        clear=True,
    )
    def test_generation_streams_through_openrouter(self):
        async def stream():
            yield b'data: {"choices":[]}\n\n'

        stream_page = Mock(return_value=stream())
        request = self.factory.post(
            "/projects/webofbabel/api/generate",
            data=json.dumps({"url": "https://example.test"}),
            content_type="application/json",
        )

        with patch.dict(
            WebOfBabel.handle_request.__globals__, {"stream_page": stream_page}
        ):
            response = self.project.handle_request("api/generate", request)

        self.assertIsInstance(response, StreamingHttpResponse)
        self.assertEqual(response["Content-Type"], "text/event-stream")
        self.assertEqual(response["X-Accel-Buffering"], "no")
        prompt, key, model = stream_page.call_args.args
        self.assertIn("https://example.test", prompt)
        self.assertEqual(key, "secret")
        self.assertEqual(model, "test/model")
