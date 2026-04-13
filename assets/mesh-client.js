/**
 * MESH CLIENT (Browser-Side Compression Engine)
 * Intercepts payloads, minifies them lightly, and compresses them via WebAssembly Brotli
 * before sending to the MeshServer.
 */

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
            // Brotli WASM loaded
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
        
        const originalSize = textBuffer.length;
        const compressedSize = compressedBuffer.length;
        const ratio = (originalSize / compressedSize).toFixed(2);
        
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
