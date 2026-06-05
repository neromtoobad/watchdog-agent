import { describe, it, expect } from 'vitest';
import { renderBadge } from '../src/badge/render';

const SVG_PREFIX = '<svg xmlns="http://www.w3.org/2000/svg"';

describe('renderBadge', () => {
  it('produces a valid SVG shell', () => {
    const svg = renderBadge('agent-x', 75, 'caution');
    expect(svg.startsWith(SVG_PREFIX)).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('healthy band uses green #3fb950', () => {
    const svg = renderBadge('a', 90, 'healthy');
    expect(svg.toLowerCase()).toContain('#3fb950');
    expect(svg.toLowerCase()).not.toContain('#d29922');
    expect(svg.toLowerCase()).not.toContain('#f85149');
  });

  it('caution band uses amber #d29922', () => {
    const svg = renderBadge('a', 65, 'caution');
    expect(svg.toLowerCase()).toContain('#d29922');
  });

  it('unsafe band uses red #f85149', () => {
    const svg = renderBadge('a', 20, 'unsafe');
    expect(svg.toLowerCase()).toContain('#f85149');
  });

  it('contains the score and "trust" label', () => {
    const svg = renderBadge('alpha', 73, 'caution');
    expect(svg).toContain('>73<');
    expect(svg).toContain('>trust<');
  });

  it('clamps score to [0,100]', () => {
    expect(renderBadge('a', -5, 'unsafe')).toContain('>0<');
    expect(renderBadge('a', 250, 'healthy')).toContain('>100<');
  });

  it('rounds the score', () => {
    expect(renderBadge('a', 73.6, 'caution')).toContain('>74<');
    expect(renderBadge('a', 73.4, 'caution')).toContain('>73<');
  });

  it('escapes the agentId so it cannot inject markup', () => {
    const svg = renderBadge('<script>alert(1)</script>', 80, 'healthy');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('includes an aria-label for accessibility', () => {
    const svg = renderBadge('agent-x', 80, 'healthy');
    expect(svg).toContain('aria-label="trust: 80 (agent-x)"');
  });

  it('falls back to caution color on an unknown band', () => {
    const svg = renderBadge('a', 50, 'whatever' as any);
    expect(svg.toLowerCase()).toContain('#d29922');
  });
});
