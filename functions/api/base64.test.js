import test from "node:test";
import assert from "node:assert/strict";
import { base64url, base64Bytes, base64urlBytes } from "../../server/base64.js";

test("native conversion preserves every byte at the attachment limit", () => {
  const bytes = Uint8Array.from({ length: 512 * 1024 }, (_, i) => i % 256);
  const standard = Buffer.from(bytes).toString("base64");
  assert.deepEqual(new Uint8Array(base64Bytes(standard)), bytes);
  assert.deepEqual(new Uint8Array(base64urlBytes(base64url(bytes))), bytes);
});

test("base64url encoding respects typed-array slice boundaries", () => {
  const bytes = new Uint8Array([0, 255, 254, 253, 0]);
  assert.equal(base64url(bytes.subarray(1, 4)), "__79");
});

test("decoding retains legacy padding, whitespace and malformed-input behavior", () => {
  for (const text of ["", "AA", "AA==", "AAA", "AAA=", " \t/\n/8=\r", "////"])
    assert.deepEqual(
      new Uint8Array(base64Bytes(text)),
      Uint8Array.from(atob(text), (c) => c.charCodeAt(0)),
    );
  for (const text of ["A", "AA=", "AA===", "AA!", "A=A=", "__79"])
    assert.throws(() => base64Bytes(text));
});
