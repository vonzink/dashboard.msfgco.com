import { describe, expect, it } from 'vitest';
import {
  MEDIA_RULES,
  loadAssetConfig,
  makeApprovedKey,
  makePublicUrl,
  makeQuarantineKey,
} from '../../../services/webinarAssets/config';

const versionId = '11111111-1111-4111-8111-111111111111';

describe('Webinar Studio asset configuration', () => {
  it('defines the specified byte ceilings for the accepted media types', () => {
    expect(MEDIA_RULES['image/png'].maxBytes).toBe(20 * 1024 * 1024);
    expect(MEDIA_RULES['image/svg+xml'].maxBytes).toBe(5 * 1024 * 1024);
    expect(MEDIA_RULES['video/mp4'].maxBytes).toBe(500 * 1024 * 1024);
  });

  it('fails closed when the upload bucket or HTTPS CDN base URL is missing', () => {
    expect(() => loadAssetConfig({})).toThrowError(
      expect.objectContaining({ code: 'ASSET_CONFIG_MISSING' }),
    );
    expect(() => loadAssetConfig({ WEBINAR_ASSET_BUCKET: 'webinar-assets' })).toThrowError(
      expect.objectContaining({ code: 'ASSET_CONFIG_MISSING' }),
    );
    expect(() => loadAssetConfig({
      WEBINAR_ASSET_BUCKET: 'webinar-assets',
      WEBINAR_ASSET_CDN_BASE_URL: 'http://assets.example',
    })).toThrowError(expect.objectContaining({ code: 'ASSET_CONFIG_INVALID' }));
  });

  it('normalizes a configured CDN base and the default quarantine prefix', () => {
    expect(loadAssetConfig({
      WEBINAR_ASSET_BUCKET: ' webinar-assets ',
      WEBINAR_ASSET_CDN_BASE_URL: 'https://assets.example/',
    })).toEqual({
      bucket: 'webinar-assets',
      cdnBaseUrl: 'https://assets.example',
      quarantinePrefix: 'quarantine/',
    });
  });

  it('rejects a quarantine prefix that could overlap the public approved namespace', () => {
    expect(() => loadAssetConfig({
      WEBINAR_ASSET_BUCKET: 'webinar-assets',
      WEBINAR_ASSET_CDN_BASE_URL: 'https://assets.example',
      WEBINAR_ASSET_QUARANTINE_PREFIX: 'approved/',
    })).toThrowError(expect.objectContaining({ code: 'ASSET_CONFIG_INVALID' }));
  });

  it('makes quarantine keys path-safe and approved keys content-addressed', () => {
    expect(makeQuarantineKey(versionId, '../../logo.png')).toBe(`quarantine/${versionId}/logo.png`);
    expect(makeApprovedKey('a'.repeat(64), '../brand mark.png'))
      .toBe(`approved/sha256/${'a'.repeat(64)}/brand mark.png`);
  });

  it('encodes approved key components in public URLs and never exposes quarantine objects', () => {
    const config = loadAssetConfig({
      WEBINAR_ASSET_BUCKET: 'webinar-assets',
      WEBINAR_ASSET_CDN_BASE_URL: 'https://assets.example/',
    });

    expect(makePublicUrl(config, `approved/sha256/${'a'.repeat(64)}/brand mark.png`))
      .toBe(`https://assets.example/approved/sha256/${'a'.repeat(64)}/brand%20mark.png`);
    expect(() => makePublicUrl(config, `quarantine/${versionId}/logo.png`)).toThrowError(
      expect.objectContaining({ code: 'ASSET_QUARANTINE_PRIVATE' }),
    );
  });
});
