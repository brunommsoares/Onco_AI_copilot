// Node-only polyfills used by pdf-parse/pdfjs-dist.
// Keep this minimal and avoid defining browser globals (window/document),
// otherwise server SDKs can mis-detect a browser environment.
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let canvas = null;
try {
  canvas = require('canvas');
} catch {
  // Optional dependency; lightweight fallbacks are used below.
}

if (!globalThis.DOMMatrix) {
  globalThis.DOMMatrix = canvas?.DOMMatrix || class DOMMatrix {
    constructor(init) {
      if (typeof init === 'string') {
        const values = init.match(/matrix\(([^)]+)\)/)?.[1]?.split(/\s*,\s*/) || [];
        this.a = parseFloat(values[0]) || 1;
        this.b = parseFloat(values[1]) || 0;
        this.c = parseFloat(values[2]) || 0;
        this.d = parseFloat(values[3]) || 1;
        this.e = parseFloat(values[4]) || 0;
        this.f = parseFloat(values[5]) || 0;
      } else {
        this.a = 1;
        this.b = 0;
        this.c = 0;
        this.d = 1;
        this.e = 0;
        this.f = 0;
      }
    }
  };
}

if (!globalThis.ImageData) {
  globalThis.ImageData = canvas?.ImageData || class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

if (!globalThis.Path2D) {
  globalThis.Path2D = canvas?.Path2D || class Path2D {
    constructor() {}
  };
}

export default {};
