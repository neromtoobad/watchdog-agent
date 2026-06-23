/* ────────────────────────────────────────────────────────────────────
   WATCHDOG · agent avatar generator
   Deterministic SVG mark per agent name: gradient orb + glyph.
   No external dependencies. Each agent gets one of 8 colors × 8 glyphs.
   ──────────────────────────────────────────────────────────────────── */
(function () {
  const PALETTE = [
    ['#3ad9a0', '#0f8f82'],
    ['#2ee6cf', '#1463a4'],
    ['#6aa8ff', '#3d52d4'],
    ['#b98cff', '#6b3fb3'],
    ['#f3c34e', '#c47214'],
    ['#ff9a6a', '#c43a3a'],
    ['#7fd1c0', '#0f8a85'],
    ['#fb6a5e', '#922a2e'],
  ];

  // 8 abstract single-color glyphs centered in a 32×32 viewBox
  const GLYPHS = [
    // ring
    '<circle cx="16" cy="16" r="6" fill="none" stroke="#fff" stroke-width="2" opacity="0.94"/>',
    // triangle
    '<path d="M16 9 L22.5 22 L9.5 22 Z" fill="#fff" opacity="0.94"/>',
    // diamond
    '<path d="M16 9 L23 16 L16 23 L9 16 Z" fill="#fff" opacity="0.94"/>',
    // three dots
    '<g fill="#fff" opacity="0.92"><circle cx="10" cy="16" r="2"/><circle cx="16" cy="16" r="2"/><circle cx="22" cy="16" r="2"/></g>',
    // rounded square
    '<rect x="10" y="10" width="12" height="12" rx="2.5" fill="#fff" opacity="0.94"/>',
    // plus
    '<path d="M15 9h2v14h-2zM9 15h14v2H9z" fill="#fff" opacity="0.94"/>',
    // cross
    '<g fill="#fff" opacity="0.94"><path d="M9.4 10.8l1.4-1.4 11.8 11.8-1.4 1.4z"/><path d="M22.6 10.8l-1.4-1.4-11.8 11.8 1.4 1.4z"/></g>',
    // two bars
    '<g fill="#fff" opacity="0.94"><rect x="10" y="10" width="3" height="12" rx="1"/><rect x="19" y="10" width="3" height="12" rx="1"/></g>',
  ];

  function hash(s) {
    let h = 5381;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /**
   * Generate inline SVG markup for an agent.
   * @param {string} name · agent identifier
   * @returns {string} SVG markup
   */
  function agentAvatar(name) {
    const h = hash(name);
    const [c1, c2] = PALETTE[h % PALETTE.length];
    const glyph = GLYPHS[Math.floor(h / 8) % GLYPHS.length];
    const id = 'g_' + h.toString(36);
    return (
      '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
        '<defs>' +
          '<linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
            '<stop offset="0" stop-color="' + c1 + '"/>' +
            '<stop offset="1" stop-color="' + c2 + '"/>' +
          '</linearGradient>' +
        '</defs>' +
        '<rect width="32" height="32" rx="9" fill="url(#' + id + ')"/>' +
        glyph +
      '</svg>'
    );
  }

  /** Color helper (for chart/legend uses elsewhere) */
  function agentColor(name) {
    const h = hash(name);
    return PALETTE[h % PALETTE.length][0];
  }

  window.WD = window.WD || {};
  window.WD.agentAvatar = agentAvatar;
  window.WD.agentColor = agentColor;
})();
