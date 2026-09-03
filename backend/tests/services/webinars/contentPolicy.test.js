import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  assertCandidateWithinLimits,
  loadResourcePolicy,
  validateAnchor,
  validateCss,
  validateJavascript,
  validateMasterHtml,
  validateSlideHtml,
} from '../../../services/webinars/contentPolicy';

const policy = loadResourcePolicy({
  WEBINAR_ASSET_CDN_BASE_URL: 'https://assets.example',
  WEBINAR_EXTERNAL_STYLE_ORIGINS: 'https://fonts.example',
  WEBINAR_EXTERNAL_FONT_ORIGINS: 'https://fonts.example',
});

describe('webinar executable-content policy', () => {
  it('requires exactly one Master mount token', () => {
    expect(validateMasterHtml('<main>{{SLIDE_CONTENT}}</main>').issues).toEqual([]);
    expect(validateMasterHtml('{{SLIDE_CONTENT}}{{SLIDE_CONTENT}}').issues[0].code).toBe('MASTER_TOKEN_COUNT');
  });

  it('rejects executable Master HTML and allows configured stylesheets', () => {
    expect(validateMasterHtml('<script>alert(1)</script>{{SLIDE_CONTENT}}').issues[0].code).toBe('FORBIDDEN_HTML');
    expect(validateMasterHtml('<main onclick="go()">{{SLIDE_CONTENT}}</main>').issues[0].code).toBe('FORBIDDEN_ATTRIBUTE');
    expect(validateMasterHtml('<link rel="stylesheet" href="https://fonts.example/theme.css">{{SLIDE_CONTENT}}', policy).issues).toEqual([]);
    expect(validateMasterHtml('<link rel="stylesheet" href="https://evil.example/theme.css">{{SLIDE_CONTENT}}', policy).issues[0].code).toBe('RESOURCE_ORIGIN_FORBIDDEN');
  });

  it('applies the HTML policy to slides without the Master token requirement', () => {
    expect(validateSlideHtml('<section><img src="{{ASSET:11111111-1111-4111-8111-111111111111}}"></section>', policy).issues).toEqual([]);
    expect(validateSlideHtml('<section onload="go()"></section>', policy).issues[0].code).toBe('FORBIDDEN_ATTRIBUTE');
    expect(validateSlideHtml('<script>go()</script>', policy).issues[0].code).toBe('FORBIDDEN_HTML');
  });

  it('parses CSS and JavaScript without executing them', () => {
    expect(validateCss('.slide { color: red;', 'slide_css').issues[0].surface).toBe('slide_css');
    expect(validateJavascript('const = 1').issues[0].code).toBe('JAVASCRIPT_SYNTAX');
    expect(validateJavascript('window.parent.document.body')).toEqual({ issues: [] });
  });

  it('validates anchors and UTF-8 byte boundaries', () => {
    expect(validateAnchor('confident-number')).toEqual({ issues: [] });
    expect(validateAnchor('Not valid')).toEqual({ issues: [{ code: 'ANCHOR_FORMAT', surface: 'anchor' }] });
    expect(() => assertCandidateWithinLimits({ masterHtml: '€'.repeat(Math.ceil(LIMITS.master_html / 3)) }))
      .toThrow(expect.objectContaining({ code: 'CONTENT_LIMIT_EXCEEDED' }));
  });

  it('rejects asset tokens until an exact HTTPS CDN origin is configured', () => {
    const noAssets = loadResourcePolicy({ WEBINAR_ASSET_CDN_BASE_URL: 'http://assets.example' });
    expect(noAssets.assetOrigin).toBeNull();
    expect(validateSlideHtml('<img src="{{ASSET:11111111-1111-4111-8111-111111111111}}">', noAssets).issues[0].code)
      .toBe('ASSET_ORIGIN_NOT_CONFIGURED');
  });

  it('checks every URL-bearing HTML attribute and embedded CSS surface', () => {
    expect(validateSlideHtml('<svg><use xlink:href="javascript:alert(1)"></use></svg>', policy).issues)
      .toContainEqual(expect.objectContaining({ code: 'EXECUTABLE_URL' }));
    expect(validateSlideHtml('<img srcset="https://evil.example/a.png 1x">', policy).issues)
      .toContainEqual(expect.objectContaining({ code: 'RESOURCE_ORIGIN_FORBIDDEN' }));
    expect(validateSlideHtml('<div style="background:url(https://evil.example/a.png)"></div>', policy).issues)
      .toContainEqual(expect.objectContaining({ code: 'RESOURCE_ORIGIN_FORBIDDEN' }));
    expect(validateSlideHtml('<style>@import "https://evil.example/a.css";</style>', policy).issues)
      .toContainEqual(expect.objectContaining({ code: 'RESOURCE_ORIGIN_FORBIDDEN' }));
  });

  it('rejects CSS URL-capable syntax that the simple url regex missed', () => {
    expect(validateCss('.slide { background: u\\72l(https://evil.example/x.png); }', 'slide_css', policy).issues)
      .not.toEqual([]);
    expect(validateCss('.slide { background-image: image-set("https://evil.example/x.png" 1x); }', 'slide_css', policy).issues)
      .toContainEqual(expect.objectContaining({ code: 'RESOURCE_ORIGIN_FORBIDDEN' }));
  });

  it('finds valid and malformed asset-token lookalikes across the whole candidate', () => {
    const noAssets = loadResourcePolicy({});
    const validToken = '{{ASSET:11111111-1111-4111-8111-111111111111}}';
    for (const candidate of [
      { masterHtml: `<p>${validToken}</p>` },
      { masterCss: `.slide::before { content: '${validToken}'; }` },
      { slides: [{ javascript: `const asset = '${validToken}';` }] },
    ]) {
      expect(() => assertCandidateWithinLimits(candidate, noAssets))
        .toThrow(expect.objectContaining({ code: 'ASSET_ORIGIN_NOT_CONFIGURED' }));
    }
    expect(() => assertCandidateWithinLimits({ masterHtml: '{{ASSET:not-a-uuid}}' }, policy))
      .toThrow(expect.objectContaining({ code: 'ASSET_TOKEN_INVALID' }));
  });

  it('accepts an exact request-size boundary and rejects one byte over', () => {
    const prefixBytes = Buffer.byteLength('{"payload":""}', 'utf8');
    expect(() => assertCandidateWithinLimits({ payload: 'x'.repeat(LIMITS.request - prefixBytes) }, policy)).not.toThrow();
    expect(() => assertCandidateWithinLimits({ payload: 'x'.repeat(LIMITS.request - prefixBytes + 1) }, policy))
      .toThrow(expect.objectContaining({ code: 'CONTENT_LIMIT_EXCEEDED' }));
  });

  it('handles deeply nested in-limit HTML without recursive stack overflow', () => {
    const nested = '<i>'.repeat(12000) + '{{SLIDE_CONTENT}}' + '</i>'.repeat(12000);
    expect(Buffer.byteLength(nested, 'utf8')).toBeLessThan(LIMITS.master_html);
    expect(validateMasterHtml(nested, policy).issues).toEqual([]);
  });

  it('drops configured origins containing credentials, paths, queries, or fragments', () => {
    for (const origin of [
      'https://user@assets.example',
      'https://assets.example/path',
      'https://assets.example?query=1',
      'https://assets.example#fragment',
    ]) {
      expect(loadResourcePolicy({ WEBINAR_ASSET_CDN_BASE_URL: origin }).assetOrigin).toBeNull();
    }
  });

  it('keeps stylesheet and font origins distinct when parsing CSS resources', () => {
    const separatedOrigins = loadResourcePolicy({
      WEBINAR_ASSET_CDN_BASE_URL: 'https://assets.example',
      WEBINAR_EXTERNAL_STYLE_ORIGINS: 'https://styles.example',
      WEBINAR_EXTERNAL_FONT_ORIGINS: 'https://fonts.example',
    });
    expect(validateCss('@import "https://styles.example/theme.css";', 'master_css', separatedOrigins).issues).toEqual([]);
  });

  it('rejects mixed-case external CSS imports', () => {
    expect(validateSlideHtml('<style>@IMPORT "https://evil.example/x.css";</style>', policy).issues)
      .toContainEqual(expect.objectContaining({ code: 'RESOURCE_ORIGIN_FORBIDDEN' }));
  });

  it('uses exact UTF-8 byte limits for every presentation source field', () => {
    const exactBytes = limit => '€'.repeat(Math.floor(limit / 3)) + 'x'.repeat(limit % 3);
    const fields = [
      ['master_html', value => ({ masterHtml: value })],
      ['master_css', value => ({ masterCss: value })],
      ['slide_html', value => ({ slides: [{ html: value }] })],
      ['slide_css', value => ({ slides: [{ css: value }] })],
      ['slide_javascript', value => ({ slides: [{ javascript: value }] })],
    ];
    for (const [surface, candidate] of fields) {
      const atLimit = exactBytes(LIMITS[surface]);
      expect(Buffer.byteLength(atLimit, 'utf8')).toBe(LIMITS[surface]);
      expect(() => assertCandidateWithinLimits(candidate(atLimit), policy)).not.toThrow();
      expect(() => assertCandidateWithinLimits(candidate(`${atLimit}x`), policy))
        .toThrow(expect.objectContaining({ code: 'CONTENT_LIMIT_EXCEEDED' }));
    }
  });

  it('scans many asset tokens without changing configured candidates', () => {
    const token = '{{ASSET:11111111-1111-4111-8111-111111111111}}';
    expect(() => assertCandidateWithinLimits({ masterHtml: token.repeat(4000) }, policy)).not.toThrow();
  });

  it('allows local CSS fragment URLs', () => {
    expect(validateCss('.slide { filter: url(#local-filter); }', 'slide_css', policy)).toEqual({ issues: [] });
  });
});
