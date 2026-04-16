/**
 * MESH CLIENT (Browser-Side Compression Engine + CSRF Token Manager)
 * Intercepts payloads, minifies them lightly, and compresses them via WebAssembly Brotli
 * before sending to the MeshServer. Also manages CSRF token for all mutating requests.
 */

// ── CSRF Token Manager ────────────────────────────────────────────────────────

const MeshCsrf = (() => {
  let _token = null;
  let _fetchPromise = null;

  async function fetchToken() {
    const res = await fetch('/api/csrf-token', { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to fetch CSRF token');
    const data = await res.json();
    _token = data.token;
    return _token;
  }

  async function getToken() {
    if (_token) return _token;
    if (!_fetchPromise) _fetchPromise = fetchToken().finally(() => { _fetchPromise = null; });
    return _fetchPromise;
  }

  /**
   * Wraps the native fetch API to automatically inject the CSRF token header
   * on all mutating requests (POST, PUT, PATCH, DELETE).
   *
   * @param {string | URL | Request} input
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async function safeFetch(input, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const token = await getToken();
      init.headers = {
        ...init.headers,
        'X-CSRF-Token': token,
      };
    }
    const res = await fetch(input, init);
    // On 403 CSRF error, refresh token and retry once.
    if (res.status === 403) {
      _token = null;
      const freshToken = await fetchToken();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        init.headers = { ...init.headers, 'X-CSRF-Token': freshToken };
      }
      return fetch(input, init);
    }
    return res;
  }

  return { getToken, safeFetch };
})();

window.MeshCsrf = MeshCsrf;

// ── MeshClient (Brotli Compression) ──────────────────────────────────────────

class MeshClient {
    constructor() {
        this.brotli = null;
        this.ready = this.init();
    }

    async init() {
        try {
            // Load Brotli WASM dynamically from unpkg
            const brotliWasm = await import('https://unpkg.com/brotli-wasm@3.0.0/index.web.js?module');
            this.brotli = await brotliWasm.default();
        } catch (err) {
            console.error("[MeshClient] Failed to load WASM Brotli:", err);
        }
    }

    /**
     * Ultra-fast client-side minification
     */
    minifyPayload(text) {
        if (typeof text !== 'string') return text;

        let minified = text;
        // Basic HTML minification (strip spaces between tags)
        if (minified.includes('<') && minified.includes('>')) {
            minified = minified.replace(/>\s+</g, '><');
        }
        // Basic JS/Text minification (strip multi-spaces and newlines safely)
        minified = minified.replace(/\n\s+/g, '\n').trim();
        return minified;
    }

    /**
     * Compresses the text payload into an ultra-small Uint8Array buffer
     */
    async compress(rawText) {
        await this.ready;
        if (!this.brotli) {
            console.warn("[MeshClient] Brotli not available, sending uncompressed.");
            return new TextEncoder().encode(rawText);
        }

        const minified = this.minifyPayload(rawText);
        const textBuffer = new TextEncoder().encode(minified);

        // Brotli QUALITY: 11 (Max)
        const compressedBuffer = this.brotli.compress(textBuffer, { quality: 11 });

        return compressedBuffer;
    }

    /**
     * Decompress responses if needed
     */
    async decompress(compressedBuffer) {
        await this.ready;
        if (!this.brotli) return new TextDecoder().decode(compressedBuffer);

        const decompressed = this.brotli.decompress(new Uint8Array(compressedBuffer));
        return new TextDecoder().decode(decompressed);
    }
}

window.Mesh = new MeshClient();
