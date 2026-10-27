import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeAssetSource,
  validateAssetSource,
  validateSvgSource,
} from './assetPipeline.js';

function svgDataUrl(source) {
  return `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
}

test('SVG validation accepts common namespace and local artwork references', () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path fill="url(#paint)" d="M0 0h24v24z"/></svg>';

  assert.doesNotThrow(() => validateSvgSource(source));
  assert.equal(validateAssetSource(svgDataUrl(source), 'image/svg+xml').length, Buffer.byteLength(source));
});

test('SVG validation rejects active elements and external references', () => {
  assert.throws(
    () =>
      validateSvgSource(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    /unsupported active content/i,
  );
  assert.throws(
    () =>
      validateSvgSource(
        '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.com/art.svg#shape"/></svg>',
      ),
    /unsupported active content/i,
  );
});

test('asset data URLs validate base64 and raster signatures', () => {
  assert.throws(
    () => decodeAssetSource('data:image/png;base64,not-base64!', 'image/png'),
    /invalid base64/i,
  );
  assert.throws(
    () =>
      validateAssetSource(
        `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`,
        'image/png',
      ),
    /not a valid PNG/i,
  );
});
