export const MAX_ARTWORK_BYTES = 2 * 1024 * 1024;
export const MAX_PROJECT_ASSETS = 100;
export const MAX_TOTAL_ARTWORK_BYTES = 8 * 1024 * 1024;
export const SUPPORTED_ARTWORK_TYPES = {
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function base64ToBytes(value) {
  if (typeof atob === 'function') {
    const decoded = atob(value);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  }
  throw new Error('This environment cannot decode embedded artwork data.');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export function getAssetByteLength(dataUrl) {
  if (typeof dataUrl !== 'string') return 0;
  const separator = dataUrl.indexOf(',');
  if (separator < 0) return 0;
  const payload = dataUrl.slice(separator + 1);
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

export function decodeAssetSource(dataUrl, mimeType) {
  const prefix = `data:${mimeType};base64,`;
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) {
    throw new Error(`Artwork data must be a base64 ${mimeType} data URL.`);
  }
  const payload = dataUrl.slice(prefix.length);
  if (!payload || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) {
    throw new Error('Artwork data contains invalid base64.');
  }
  const bytes = base64ToBytes(payload);
  if (bytes.length > MAX_ARTWORK_BYTES) {
    throw new Error('Artwork files must be 2 MB or smaller.');
  }
  return bytes;
}

export function validateSvgSource(source) {
  if (typeof source !== 'string' || !/<svg(?:\s|>)/i.test(source)) {
    throw new Error('The vector artwork is not a valid SVG document.');
  }
  const sourceWithoutNamespaces = source.replace(
    /\sxmlns(?::\w+)?\s*=\s*["']https?:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)["']/gi,
    '',
  );
  if (
    /<!DOCTYPE|<!ENTITY|<(?:script|foreignObject|iframe|object|embed|image|audio|video|animate|animateTransform|set)\b/i.test(
      sourceWithoutNamespaces,
    ) ||
    /\bon[a-z]+\s*=/i.test(sourceWithoutNamespaces) ||
    /(?:javascript|vbscript|https?|file|data):/i.test(sourceWithoutNamespaces) ||
    /url\(\s*["']?(?!#)/i.test(sourceWithoutNamespaces) ||
    /@import\b/i.test(sourceWithoutNamespaces) ||
    /(?:href|xlink:href)\s*=\s*["'](?!#)/i.test(sourceWithoutNamespaces)
  ) {
    throw new Error(
      'SVG artwork contains scripts, external references, or unsupported active content.',
    );
  }
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    if (
      document.querySelector('parsererror') ||
      document.documentElement.localName !== 'svg'
    ) {
      throw new Error('The vector artwork is not well-formed SVG.');
    }
  }
  return source;
}

export function validateAssetSource(dataUrl, mimeType) {
  const bytes = decodeAssetSource(dataUrl, mimeType);
  if (mimeType === 'image/svg+xml') {
    validateSvgSource(new TextDecoder().decode(bytes));
  } else if (
    mimeType === 'image/png' &&
    ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    )
  ) {
    throw new Error('Artwork data is not a valid PNG file.');
  } else if (
    mimeType === 'image/webp' &&
    (bytes.length < 12 ||
      String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF' ||
      String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP')
  ) {
    throw new Error('Artwork data is not a valid WebP file.');
  }
  return bytes;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read "${file.name}" as artwork data.`));
      } else {
        resolve(reader.result);
      }
    };
    reader.readAsDataURL(file);
  });
}

function svgToDataUrl(source) {
  const bytes = new TextEncoder().encode(source);
  return `data:image/svg+xml;base64,${bytesToBase64(bytes)}`;
}

function readImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error('Artwork has invalid image dimensions.'));
        return;
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => reject(new Error('The selected artwork could not be decoded.'));
    image.src = dataUrl;
  });
}

export async function importArtworkFile(file, id) {
  if (!(file instanceof Blob) || typeof file.name !== 'string') {
    throw new Error('Choose a PNG, WebP, or SVG artwork file.');
  }
  if (file.size <= 0 || file.size > MAX_ARTWORK_BYTES) {
    throw new Error('Artwork files must be between 1 byte and 2 MB.');
  }
  const extension = `.${file.name.split('.').pop()?.toLowerCase()}`;
  const expectedType = SUPPORTED_ARTWORK_TYPES[extension];
  if (!expectedType) {
    throw new Error('Only PNG, WebP, and SVG artwork files are supported.');
  }
  if (file.type && file.type !== expectedType) {
    throw new Error(`The selected file extension does not match ${file.type}.`);
  }

  let dataUrl;
  if (expectedType === 'image/svg+xml') {
    const source = validateSvgSource(await file.text());
    dataUrl = svgToDataUrl(source);
  } else {
    dataUrl = await readFileAsDataUrl(file);
  }
  const bytes = validateAssetSource(dataUrl, expectedType);
  const dimensions = await readImageDimensions(dataUrl);
  return {
    id,
    name: file.name.slice(0, 160),
    mimeType: expectedType,
    dataUrl,
    byteLength: bytes.length,
    ...dimensions,
  };
}
