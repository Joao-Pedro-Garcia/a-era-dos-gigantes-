import { describe, expect, it } from 'vitest';
import { decodeDataUri } from '../src/graphics/externalModels';

describe('embedded glTF data', () => {
  it('decodes base64 data: URIs in memory (no fetch, which strict CSPs refuse)', () => {
    const bytes = [0, 1, 2, 250, 255, 128];
    const uri = `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`;
    expect([...new Uint8Array(decodeDataUri(uri))]).toEqual(bytes);
  });
});
