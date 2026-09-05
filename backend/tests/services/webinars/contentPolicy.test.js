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

  it('reserves the renderer mount attribute on Master and slide elements only', () => {
    for (const html of [
      '<main data-slide-mount>{{SLIDE_CONTENT}}</main>',
      '<main DATA-SLIDE-MOUNT="owned">{{SLIDE_CONTENT}}</main>',
    ]) {
      expect(validateMasterHtml(html, policy).issues).toContainEqual(expect.objectContaining({
        code: 'RESERVED_ATTRIBUTE',
        surface: 'master_html',
        attribute: 'data-slide-mount',
      }));
    }
    for (const html of [
      '<section data-slide-mount=owned></section>',
      "<svg><g DaTa-SlIdE-MoUnT='owned'></g></svg>",
    ]) {
      expect(validateSlideHtml(html, policy).issues).toContainEqual(expect.objectContaining({
        code: 'RESERVED_ATTRIBUTE',
        surface: 'slide_html',
        attribute: 'data-slide-mount',
      }));
    }

    expect(validateSlideHtml([
      '<p>data-slide-mount is documentation.</p>',
      '<p title="data-slide-mount" data-slide-mountish>Safe values</p>',
      '<!-- <div data-slide-mount>commented example</div> -->',
      '<textarea><div data-slide-mount>raw text</div></textarea>',
    ].join(''), policy).issues).toEqual([]);
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

  it('rejects noncanonical raw origin spellings that URL parsing would erase', () => {
    for (const origin of [
      'https://assets.example?',
      'https://assets.example#',
      'https://assets.example/.',
      'https://assets.example/path/..',
    ]) {
      expect(loadResourcePolicy({ WEBINAR_ASSET_CDN_BASE_URL: origin }).assetOrigin).toBeNull();
    }
    expect(loadResourcePolicy({ WEBINAR_ASSET_CDN_BASE_URL: 'https://assets.example' }).assetOrigin)
      .toBe('https://assets.example');
    expect(loadResourcePolicy({ WEBINAR_ASSET_CDN_BASE_URL: 'https://assets.example/' }).assetOrigin)
      .toBe('https://assets.example');
  });

  it('keeps stylesheet and font origins distinct when parsing CSS resources', () => {
    const separatedOrigins = loadResourcePolicy({
      WEBINAR_ASSET_CDN_BASE_URL: 'https://assets.example',
      WEBINAR_EXTERNAL_STYLE_ORIGINS: 'https://styles.example',
      WEBINAR_EXTERNAL_FONT_ORIGINS: 'https://fonts.example',
    });
    expect(validateCss('@import "https://styles.example/theme.css";', 'master_css', separatedOrigins).issues).toEqual([]);
    expect(validateCss('@font-face { src: url("https://fonts.example/font.woff2"); }', 'master_css', separatedOrigins).issues).toEqual([]);
    expect(validateCss('.hero { background: url("https://fonts.example/not-a-font.png"); }', 'master_css', separatedOrigins).issues)
      .toContainEqual(expect.objectContaining({ code: 'RESOURCE_ORIGIN_FORBIDDEN' }));
    expect(validateCss('.hero { cursor: url("https://fonts.example/not-a-cursor.cur"), auto; }', 'master_css', separatedOrigins).issues)
      .toContainEqual(expect.objectContaining({ code: 'RESOURCE_ORIGIN_FORBIDDEN' }));
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

  it('allows a complete multi-slide deck above 2 MiB when every field remains within its limit', () => {
    const largeSlides = Array.from({ length: 3 }, (_, index) => ({
      id: `11111111-1111-4111-8111-11111111111${index}`,
      html: 'h'.repeat(LIMITS.slide_html),
      css: 'c'.repeat(LIMITS.slide_css),
      javascript: 'j'.repeat(LIMITS.slide_javascript),
    }));
    const candidate = {
      masterHtml: '<main>{{SLIDE_CONTENT}}</main>',
      masterCss: '',
      slides: largeSlides,
    };
    expect(Buffer.byteLength(JSON.stringify(candidate), 'utf8')).toBeGreaterThan(LIMITS.request);
    expect(() => assertCandidateWithinLimits(candidate, policy)).not.toThrow();
  });

  it('allows local CSS fragment URLs', () => {
    expect(validateCss('.slide { filter: url(#local-filter); }', 'slide_css', policy)).toEqual({ issues: [] });
  });

  it('does not let a local fragment mask sibling URL-capable functions', () => {
    expect(validateCss(
      '.slide { background-image: url(#local-filter), image-set("data:image/png;base64,AAAA" 1x); }',
      'slide_css',
      policy,
    ).issues).toContainEqual(expect.objectContaining({ code: 'CSS_VALUE_UNSUPPORTED' }));
    expect(validateCss(
      '.slide { background-image: image-set("data:image/png;base64,AAAA" 1x); }',
      'slide_css',
      policy,
    ).issues).toContainEqual(expect.objectContaining({ code: 'CSS_VALUE_UNSUPPORTED' }));
    expect(validateCss(
      '.slide { background-image: -webkit-image-set("data:image/png;base64,AAAA" 1x); }',
      'slide_css',
      policy,
    ).issues).toContainEqual(expect.objectContaining({ code: 'CSS_VALUE_UNSUPPORTED' }));
  });
});
