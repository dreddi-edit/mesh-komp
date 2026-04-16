/**
 * dom-utils.js — XSS-safe DOM helpers for Mesh frontend.
 * safeHtml() wraps DOMPurify to sanitize before any innerHTML assignment.
 * safeEl() uses textContent exclusively — no HTML parsing at all.
 */

(function (global) {

  const ALLOWED_TAGS = [
    'b', 'i', 'em', 'strong', 'a', 'code', 'pre', 'span', 'div', 'p', 'br',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img', 'blockquote', 'hr', 'details', 'summary',
  ];

  const ALLOWED_ATTR = [
    'href', 'class', 'target', 'rel', 'src', 'alt', 'title', 'id',
    'data-raw-code', 'data-path', 'data-p', 'data-idx',
  ];

  /**
   * Sanitize an HTML string with DOMPurify using the Mesh allowlist.
   * Falls back to HTML-escaped plain text if DOMPurify is not loaded.
   *
   * @param {string} html
   * @returns {string}
   */
  function sanitizeHtml(html) {
    if (typeof DOMPurify === 'undefined') {
      return String(html || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    return DOMPurify.sanitize(String(html || ''), { ALLOWED_TAGS, ALLOWED_ATTR });
  }

  /**
   * Set element content to DOMPurify-sanitized HTML.
   * Use when the content legitimately contains markup (e.g. search highlights).
   *
   * @param {Element} el
   * @param {string} html
   */
  function safeHtml(el, html) {
    // sanitizeHtml strips all disallowed tags/attrs before assignment
    el.innerHTML = sanitizeHtml(html); // safe: DOMPurify sanitized
  }

  /**
   * Create an element whose content is plain text (XSS-safe via textContent).
   * Use when no HTML markup is needed in the output.
   *
   * @param {string} tag
   * @param {string} text
   * @param {string} [className]
   * @returns {Element}
   */
  function safeEl(tag, text, className) {
    const el = document.createElement(tag);
    el.textContent = String(text || '');
    if (className) el.className = className;
    return el;
  }

  global.DomUtils = { sanitizeHtml, safeHtml, safeEl };

})(window);
