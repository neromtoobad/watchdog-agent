import type { TrustBand } from '../index';

const BAND_COLORS: Record<TrustBand, string> = {
  healthy: '#3fb950', // green
  caution: '#d29922', // amber
  unsafe: '#f85149',  // red
};

const LEFT_BG = '#555';
const TEXT_COLOR = '#fff';
const FONT = 'DejaVu Sans,Verdana,Geneva,sans-serif';
const HEIGHT = 20;
const LEFT_WIDTH = 50;
const RIGHT_WIDTH = 50;
const RADIUS = 3;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function renderBadge(agentId: string, score: number, band: TrustBand): string {
  const total = LEFT_WIDTH + RIGHT_WIDTH;
  const color = BAND_COLORS[band] ?? BAND_COLORS.caution;
  const safeScore = Math.max(0, Math.min(100, Math.round(score)));
  const scoreText = String(safeScore);
  const safeAgent = escapeXml(agentId);
  const leftMid = LEFT_WIDTH / 2;
  const rightMid = LEFT_WIDTH + RIGHT_WIDTH / 2;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${HEIGHT}" role="img" aria-label="trust: ${safeScore} (${safeAgent})">`,
    `<title>trust: ${safeScore} — ${safeAgent} (${band})</title>`,
    `<linearGradient id="g" x2="0" y2="100%">`,
      `<stop offset="0" stop-color="#fff" stop-opacity=".1"/>`,
      `<stop offset="1" stop-opacity=".15"/>`,
    `</linearGradient>`,
    `<clipPath id="r"><rect width="${total}" height="${HEIGHT}" rx="${RADIUS}" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)">`,
      `<rect width="${LEFT_WIDTH}" height="${HEIGHT}" fill="${LEFT_BG}"/>`,
      `<rect x="${LEFT_WIDTH}" width="${RIGHT_WIDTH}" height="${HEIGHT}" fill="${color}"/>`,
      `<rect width="${total}" height="${HEIGHT}" fill="url(#g)"/>`,
    `</g>`,
    `<g fill="${TEXT_COLOR}" text-anchor="middle" font-family="${FONT}" font-size="11">`,
      `<text x="${leftMid}" y="14">trust</text>`,
      `<text x="${rightMid}" y="14">${scoreText}</text>`,
    `</g>`,
    `</svg>`,
  ].join('');
}
