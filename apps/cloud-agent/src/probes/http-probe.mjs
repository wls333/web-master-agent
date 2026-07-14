export async function collectHttpProbe(url) {
  if (!url) return { configured: false };
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return {
      configured: true,
      url,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started
    };
  } catch (error) {
    return {
      configured: true,
      url,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - started
    };
  } finally {
    clearTimeout(timeout);
  }
}
