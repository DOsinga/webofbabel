// ── LLM provider layer ─────────────────────────────────────────
// Provides a unified streaming interface: complete(messages, config, abortSignal) → AsyncIterator<string>

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function throwApiError(provider, res) {
  const raw = await res.text();
  let message = raw;
  try {
    const data = JSON.parse(raw);
    message = data.error?.message || data.message || raw;
  } catch {}

  if (provider === 'Anthropic' && message.includes('CORS requests are not allowed')) {
    const err = new Error('This Anthropic organization blocks browser requests because it uses custom data retention. Use an Anthropic key from another organization or choose a different provider in Options.');
    err.openConfig = true;
    throw err;
  }

  const err = new Error(`${provider} API error ${res.status}: ${message}`);
  err.openConfig = res.status === 401 || res.status === 403;
  throw err;
}

async function* complete(messages, config, abortSignal) {
  const { provider, model, key, ollamaUrl } = config;

  if (!key && provider !== 'ollama') {
    throw new Error('__NO_KEY__');
  }

  if (provider === 'anthropic') {
    yield* completeAnthropic(messages, model, key, abortSignal);
  } else if (provider === 'openai') {
    yield* completeOpenAI(messages, model, key, 'https://api.openai.com/v1/chat/completions', abortSignal, 'OpenAI');
  } else if (provider === 'gemini') {
    yield* completeOpenAI(messages, model, key, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', abortSignal, 'Google Gemini');
  } else if (provider === 'openrouter') {
    yield* completeOpenAI(messages, model, key, 'https://openrouter.ai/api/v1/chat/completions', abortSignal, 'OpenRouter');
  } else if (provider === 'ollama') {
    yield* completeOpenAI(messages, model, key, (ollamaUrl || 'http://localhost:11434') + '/v1/chat/completions', abortSignal, 'Ollama');
  }
}

async function* completeAnthropic(messages, model, key, abortSignal) {
  const systemMsg = messages.find(m => m.role === 'system');
  const userMsgs = messages.filter(m => m.role !== 'system');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 16000,
      stream: true,
      system: systemMsg ? systemMsg.content : '',
      messages: userMsgs,
    }),
    signal: abortSignal,
  });

  if (!res.ok) {
    await throwApiError('Anthropic', res);
  }

  yield* readSSEStream(res, function(evt) {
    if (evt.type === 'content_block_delta' && evt.delta?.text) {
      return evt.delta.text;
    }
    return null;
  });
}

async function* completeOpenAI(messages, model, key, url, abortSignal, provider) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, messages, stream: true, max_completion_tokens: 16000 }),
    signal: abortSignal,
  });

  if (!res.ok) {
    await throwApiError(provider, res);
  }

  yield* readSSEStream(res, function(evt) {
    const delta = evt.choices?.[0]?.delta?.content;
    return delta || null;
  });
}

// Shared SSE stream reader
async function* readSSEStream(res, extractText) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const evt = JSON.parse(data);
        const text = extractText(evt);
        if (text) yield text;
      } catch {}
    }
  }
}

// ── System prompt & message builder ────────────────────────────

const SYSTEM_PROMPT = `You are the internet. When given a URL, generate a complete, plausible HTML page that could exist at that address. Output ONLY raw HTML (starting with <!DOCTYPE html> or <html>). No markdown, no code fences, no explanation.

Guidelines:
- Make the page look convincing and feel like a real website at that URL
- Include realistic content, navigation, styling — the more specific and detailed the better
- Lean into hallucination: invent plausible content, people, articles, products
- Include several clickable <a href="..."> links to other pages (use full absolute URLs like http://...) so the user can keep browsing
- Use inline <style> tags for CSS. Make it look like a real website
- If the URL suggests a specific era or style, match it
- Keep the HTML self-contained (inline styles and scripts, no external resources)
- Include a <link rel="icon" href="data:image/svg+xml,..."> favicon as an inline SVG data URI — something fitting for the site
- Be creative and surprising. The pages should feel alive.`;

function buildMessages(url, history, historyIndex, linkText, formData) {
  let userMsg = `URL: ${url}`;
  if (linkText) userMsg += `\nThe user clicked a link with text: "${linkText}"`;
  if (formData) {
    const pairs = Object.entries(formData).map(([k, v]) => `  ${k}: ${v}`).join('\n');
    userMsg += `\nThe user submitted a form with the following data:\n${pairs}`;
  }
  userMsg += `\n\nGenerate the full HTML page for this URL.`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMsg },
  ];
}
