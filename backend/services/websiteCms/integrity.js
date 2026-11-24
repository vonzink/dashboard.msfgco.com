const { createHash } = require('node:crypto');
const { parseSiteSnapshot, parseActivePointer } = require('../../contracts/website/v1');
const { fail } = require('./errors');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 24 * 1024 * 1024;
const MAX_RELEASE_BYTES = 128 * 1024 * 1024;
function validateBundle(bundle) {
  try {
    const pointer = parseActivePointer(structuredClone(bundle.pointer));
    const manifest = Buffer.from(bundle.manifest);
    if (manifest.length > MAX_MANIFEST_BYTES || hash(manifest) !== pointer.sha256) throw Error();
    const snapshot = parseSiteSnapshot(JSON.parse(manifest.toString('utf8')));
    if (snapshot.publicationId !== pointer.publicationId) throw Error();
    let bytes = manifest.length;
    for (const set of snapshot.media) for (const file of set.files) {
      const asset = bundle.assets[file.path];
      if (!asset || asset.length !== file.bytes || asset.length > MAX_ASSET_BYTES || hash(asset) !== file.sha256) throw Error();
      bytes += asset.length;
      if (bytes > MAX_RELEASE_BYTES) throw Error();
    }
    return { ...bundle, pointer, manifest, snapshot };
  } catch { fail(422, 'website_release_invalid'); }
}
module.exports = { hash, validateBundle, MAX_MANIFEST_BYTES, MAX_ASSET_BYTES, MAX_RELEASE_BYTES };
