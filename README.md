# The Web of Babel

A browser for an internet that does not exist. Enter any address and an AI
generates a plausible page, including links that lead deeper into the imagined
web.

Run it locally with:

```bash
OPENROUTER_API_KEY=your-key uvx douwe webofbabel
```

Page generation runs through OpenRouter on the server, so API keys are never
sent to the browser. It uses `deepseek/deepseek-v4.1-flash-1017` by default.
Set `WEBOFBABEL_MODEL` to use another OpenRouter model.
