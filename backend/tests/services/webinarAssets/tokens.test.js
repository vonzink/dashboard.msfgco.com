import { describe, expect, it } from 'vitest';
import {
  ASSET_TOKEN_PATTERN,
  collectSurfaceTokens,
  extractAssetVersionIds,
  replaceAssetTokens,
} from '../../../services/webinarAssets/tokens';

const firstVersionId = '11111111-1111-4111-8111-111111111111';
const secondVersionId = '22222222-2222-4222-8222-222222222222';
const lowercaseVersionIdWithLetter = '33333333-3333-4333-8333-33333333333a';
const uppercaseVersionIdWithLetter = '33333333-3333-4333-8333-33333333333A';

describe('Webinar Studio asset tokens', () => {
  it('recognizes only canonical UUID asset tokens and extracts every version ID', () => {
    const source = `url('{{ASSET:${firstVersionId}}}') {{ASSET:${secondVersionId}}}`;

    expect(ASSET_TOKEN_PATTERN.test(`{{ASSET:${firstVersionId}}}`)).toBe(true);
    expect(ASSET_TOKEN_PATTERN.test('{{ASSET:not-a-uuid}}')).toBe(false);
    expect(extractAssetVersionIds(source)).toEqual([firstVersionId, secondVersionId]);
  });

  it('rejects malformed asset-token lookalikes instead of preserving them', () => {
    expect(() => extractAssetVersionIds('{{ASSET:not-a-uuid}}')).toThrowError(
      expect.objectContaining({ code: 'ASSET_TOKEN_FORMAT' }),
    );
    expect(() => replaceAssetTokens('{{ASSET:not-a-uuid}}', new Map())).toThrowError(
      expect.objectContaining({ code: 'ASSET_TOKEN_FORMAT' }),
    );
  });

  it('rejects uppercase UUID text before URL lookup', () => {
    const uppercaseToken = `{{ASSET:${uppercaseVersionIdWithLetter}}}`;

    expect(ASSET_TOKEN_PATTERN.test(uppercaseToken)).toBe(false);
    expect(() => extractAssetVersionIds(uppercaseToken)).toThrowError(
      expect.objectContaining({ code: 'ASSET_TOKEN_FORMAT' }),
    );
    expect(() => replaceAssetTokens(
      uppercaseToken,
      new Map([[lowercaseVersionIdWithLetter, 'https://assets.example/versions/three.png']]),
    )).toThrowError(expect.objectContaining({ code: 'ASSET_TOKEN_FORMAT' }));
  });

  it('replaces every resolvable token and rejects missing version URLs', () => {
    expect(replaceAssetTokens(
      `url('{{ASSET:${firstVersionId}}}')`,
      new Map([[firstVersionId, 'https://assets.example/versions/one.png']]),
    )).toBe("url('https://assets.example/versions/one.png')");
    expect(() => replaceAssetTokens(`{{ASSET:${firstVersionId}}}`, new Map())).toThrowError(
      expect.objectContaining({ code: 'ASSET_TOKEN_UNRESOLVED' }),
    );
  });

  it('collects each content surface and deduplicates repeated Master references', () => {
    expect(collectSurfaceTokens({
      masterHtml: `{{ASSET:${firstVersionId}}}{{ASSET:${firstVersionId}}}`,
      masterCss: `url('{{ASSET:${secondVersionId}}}')`,
      slides: [{
        id: 'slide-1',
        html: `{{ASSET:${firstVersionId}}}`,
        css: `url('{{ASSET:${secondVersionId}}}')`,
        javascript: `const id = '{{ASSET:${firstVersionId}}}';`,
      }],
    })).toEqual([
      { slideId: null, surface: 'master_html', assetVersionId: firstVersionId },
      { slideId: null, surface: 'master_css', assetVersionId: secondVersionId },
      { slideId: 'slide-1', surface: 'slide_html', assetVersionId: firstVersionId },
      { slideId: 'slide-1', surface: 'slide_css', assetVersionId: secondVersionId },
      { slideId: 'slide-1', surface: 'slide_javascript', assetVersionId: firstVersionId },
    ]);
  });

  it('rejects malformed asset-token lookalikes in every persisted surface', () => {
    expect(() => collectSurfaceTokens({
      masterHtml: '',
      masterCss: '',
      slides: [{ id: 'slide-1', html: '', css: '{{ASSET:not-a-uuid}}', javascript: '' }],
    })).toThrowError(expect.objectContaining({ code: 'ASSET_TOKEN_FORMAT' }));
  });
});
