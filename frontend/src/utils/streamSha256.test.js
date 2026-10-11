import { sha256ReadableStream } from "./streamSha256";
import { createHash } from "crypto";

function readableFrom(chunks) {
  let index = 0;
  return {
    getReader: () => ({
      async read() {
        if (index === chunks.length) return { done: true };
        return { done: false, value: chunks[index++] };
      },
      releaseLock() {}
    })
  };
}

test("sha256ReadableStream matches standard SHA-256 vectors across stream chunks", async () => {
  expect(await sha256ReadableStream(readableFrom([]))).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  expect(await sha256ReadableStream(readableFrom([
    new Uint8Array([97]),
    new Uint8Array([98, 99])
  ]))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  const payload = new Uint8Array(1024).fill(97);
  const expected = createHash("sha256").update(payload).digest("hex");
  expect(await sha256ReadableStream(readableFrom([
    payload.subarray(0, 55),
    payload.subarray(55, 511),
    payload.subarray(511)
  ]))).toBe(expected);
});
