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
});
