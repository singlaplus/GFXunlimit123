import { getAssetSourceDimensions } from "./assetDimensions";

const bufferFromText = (text) => Uint8Array.from(
  [...text].map((character) => character.charCodeAt(0))
).buffer;

describe("getAssetSourceDimensions", () => {
  it("uses a high-resolution EPS bounding box when available", () => {
    expect(getAssetSourceDimensions(
      bufferFromText("%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 596 842\n%%HiResBoundingBox: 0 0 595.2756 841.8898\n"),
      "new-year.eps"
    )).toEqual({ width: 595.2756, height: 841.8898 });
  });

  it.each([
    ["psd", 1],
    ["psb", 2],
  ])("reads %s pixel dimensions from its binary header", (extension, version) => {
    const buffer = new ArrayBuffer(26);
    const view = new DataView(buffer);
    new Uint8Array(buffer, 0, 4).set([0x38, 0x42, 0x50, 0x53]);
    view.setUint16(4, version, false);
    view.setUint32(14, 2400, false);
    view.setUint32(18, 1600, false);

    expect(getAssetSourceDimensions(buffer, `layered.${extension}`))
      .toEqual({ width: 1600, height: 2400 });
  });

  it("reads Illustrator PDF MediaBox dimensions", () => {
    expect(getAssetSourceDimensions(
      bufferFromText("%PDF-1.5\n/MediaBox [10 20 610 820]\n"),
      "illustration.ai"
    )).toEqual({ width: 600, height: 800 });
  });
});
