'use strict';

/**
 * HTTP response compression middleware.
 *
 * Compresses responses using Brotli, gzip, or deflate based on the client's
 * Accept-Encoding header. Uses Node.js built-in zlib — no external dependencies.
 *
 * Skipped for:
 * - SSE streams (text/event-stream) — chunked streaming must not be buffered
 * - WebSocket upgrade requests
 * - Responses below the size threshold (not worth the CPU overhead)
 * - Responses that already have a Content-Encoding set
 *
 * @module middleware/compression
 */

const zlib = require('node:zlib');

const COMPRESSION_THRESHOLD_BYTES = 1024;

const COMPRESSIBLE_TYPES = /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded)|image\/svg)/i;

/**
 * Parse the Accept-Encoding header and return the best supported encoding.
 *
 * @param {string} acceptEncoding
 * @returns {'br' | 'gzip' | 'deflate' | null}
 */
function selectEncoding(acceptEncoding) {
  if (!acceptEncoding) return null;
  if (acceptEncoding.includes('br')) return 'br';
  if (acceptEncoding.includes('gzip')) return 'gzip';
  if (acceptEncoding.includes('deflate')) return 'deflate';
  return null;
}

/**
 * Determine whether the response Content-Type is compressible.
 *
 * @param {string} contentType
 * @returns {boolean}
 */
function isCompressible(contentType) {
  if (!contentType) return false;
  return COMPRESSIBLE_TYPES.test(contentType);
}

/**
 * Express middleware that transparently compresses HTTP responses.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function compressionMiddleware(req, res, next) {
  // Skip WebSocket upgrades
  if (req.headers.upgrade) return next();

  const encoding = selectEncoding(String(req.headers['accept-encoding'] || ''));
  if (!encoding) return next();

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  let compressor = null;
  let headersSent = false;
  let bypassCompression = false;

  /**
   * Lazily create the compressor on first write, once we know Content-Type
   * and Content-Length. This lets us skip small or non-compressible responses.
   *
   * @param {Buffer | string} chunk
   * @returns {boolean} true if compression is active
   */
  function initCompressor(chunk) {
    if (bypassCompression || compressor) return !bypassCompression;

    const contentType = res.getHeader('Content-Type') || '';
    const contentLength = Number(res.getHeader('Content-Length') || 0);
    const contentEncoding = res.getHeader('Content-Encoding');

    // Skip already-encoded, non-compressible, or SSE responses
    const isSSE = String(contentType).includes('text/event-stream');
    const chunkSize = chunk ? (Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)) : 0;
    const tooSmall = contentLength > 0 && contentLength < COMPRESSION_THRESHOLD_BYTES;
    const smallChunk = contentLength === 0 && chunkSize < COMPRESSION_THRESHOLD_BYTES;

    if (contentEncoding || isSSE || tooSmall || smallChunk || !isCompressible(String(contentType))) {
      bypassCompression = true;
      return false;
    }

    compressor = encoding === 'br'
      ? zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
      : encoding === 'gzip'
        ? zlib.createGzip({ level: 6 })
        : zlib.createDeflate({ level: 6 });

    compressor.on('data', (data) => originalWrite(data));
    compressor.on('end', () => originalEnd());
    compressor.on('error', () => {
      // If compression fails mid-stream, fall back to closing cleanly
      originalEnd();
    });

    if (!headersSent) {
      res.removeHeader('Content-Length'); // Length changes after compression
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Vary', 'Accept-Encoding');
      headersSent = true;
    }

    return true;
  }

  res.write = function (chunk, encoding, callback) {
    if (!initCompressor(chunk)) return originalWrite(chunk, encoding, callback);
    compressor.write(chunk, encoding, callback);
    return true;
  };

  res.end = function (chunk, encoding, callback) {
    if (chunk && !initCompressor(chunk)) return originalEnd(chunk, encoding, callback);
    if (bypassCompression || !compressor) return originalEnd(chunk, encoding, callback);

    if (chunk) {
      compressor.end(chunk, encoding, callback);
    } else {
      compressor.end(callback);
    }
    return res;
  };

  next();
}

module.exports = { compressionMiddleware };
