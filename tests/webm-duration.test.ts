import { describe, expect, it } from "vitest";
import { readTimecodeScale, readWebmDuration, webmDurationSeconds, withWebmDuration } from "@/lib/voice/webm-duration";

/* A miniature version of what MediaRecorder writes: a header, an Info section, and clusters of
 * unknown size, each stamped with the time it starts at. */

const bytes = (...values: number[]) => Uint8Array.from(values);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
/** An element with a known, single-byte size. */
const element = (id: number[], content: Uint8Array) => concat(bytes(...id), bytes(0x80 | content.length), content);
/** An element whose size is left open, the way a recorder writes one while still recording. */
const streaming = (id: number[], content: Uint8Array) => concat(bytes(...id), bytes(0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), content);

const simpleBlock = (relativeMs: number) => {
  const block = new Uint8Array(6); // track number, 16-bit offset, flags, one byte of "audio"
  block[0] = 0x81;
  new DataView(block.buffer).setInt16(1, relativeMs);
  return element([0xa3], block);
};
const cluster = (timecodeMs: number, ...offsets: number[]) =>
  streaming([0x1f, 0x43, 0xb6, 0x75], concat(element([0xe7], bytes(timecodeMs >> 8, timecodeMs & 0xff)), ...offsets.map(simpleBlock)));

const recording = (...clusters: Uint8Array[]) =>
  concat(
    element([0x1a, 0x45, 0xdf, 0xa3], bytes(0x42, 0x86, 0x81, 0x01)),
    streaming([0x18, 0x53, 0x80, 0x67], concat(element([0x15, 0x49, 0xa9, 0x66], element([0x2a, 0xd7, 0xb1], bytes(0x0f, 0x42, 0x40))), ...clusters)),
  );

describe("reading how long a recording is", () => {
  it("uses the last block of the last cluster", () => {
    const file = recording(cluster(0, 0, 500), cluster(4000, 0, 980));
    expect(readWebmDuration(file)).toBe(4980);
    expect(webmDurationSeconds(file)).toBeCloseTo(4.98);
    expect(readTimecodeScale(file)).toBe(1);
  });

  it("walks past clusters whose size was never written", () => {
    const file = recording(cluster(0, 0), cluster(4000, 0), cluster(8000, 0), cluster(12_000, 0, 750));
    expect(readWebmDuration(file)).toBe(12_750);
  });

  it("returns nothing for a file it cannot read", () => {
    expect(readWebmDuration(bytes(1, 2, 3, 4, 5, 6, 7, 8))).toBeNull();
    expect(webmDurationSeconds(new Uint8Array(0))).toBeNull();
  });
});

describe("writing the length into a recording", () => {
  const file = recording(cluster(0, 0, 500), cluster(4000, 0, 980));

  it("adds the duration without disturbing anything else", () => {
    const patched = withWebmDuration(file);
    expect(patched.length).toBe(file.length + 11);
    expect(readWebmDuration(patched)).toBe(4980); // the audio still reads back the same
    expect(readTimecodeScale(patched)).toBe(1);

    const at = patched.findIndex((_, i) => patched[i] === 0x44 && patched[i + 1] === 0x89 && patched[i + 2] === 0x88);
    expect(at).toBeGreaterThan(0);
    expect(new DataView(patched.buffer, patched.byteOffset + at + 3, 8).getFloat64(0)).toBe(4980);
  });

  it("leaves a recording that already has a duration alone", () => {
    const patched = withWebmDuration(file);
    expect(withWebmDuration(patched)).toHaveLength(patched.length);
  });

  it("leaves a file it cannot read alone", () => {
    const broken = bytes(1, 2, 3, 4);
    expect(withWebmDuration(broken)).toBe(broken);
  });
});
