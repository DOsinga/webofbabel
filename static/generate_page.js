function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

async function throwApiError(res) {
  const raw = await res.text();
  let message = raw;
  try {
    const data = JSON.parse(raw);
    message = data.error?.message || data.error || data.message || raw;
  } catch {}
  throw new Error(`Generation error ${res.status}: ${message}`);
}

async function* complete(url, linkText, formData, abortSignal) {
  const res = await fetch('/projects/webofbabel/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, linkText, formData }),
    signal: abortSignal,
  });

  if (!res.ok) await throwApiError(res);
  yield* readSSEStream(res);
}

async function* readSSEStream(res) {
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

      let event;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.error) {
        throw new Error(event.error.message || String(event.error));
      }
      const text = event.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  }
}
