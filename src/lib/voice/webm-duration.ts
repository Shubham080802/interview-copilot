/**
 * Recordings are written while the interview is still going, so MediaRecorder cannot know how long
 * they will be and leaves the duration out of the file. Browsers then report an infinite length:
 * the player shows no timeline and refuses to seek.
 *
 * The length is recoverable — it is the timestamp of the last block of audio — so this reads it
 * back out of the file and writes it into the header, which is all a player needs.
 * Pure byte handling, so it can be tested without a browser.
 */

const ID_EBML_HEADER = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_TIMECODE_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMECODE = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;

interface Element {
  id: number;
  /** Offset of the element's content. */
  start: number;
  /** Offset just past the content, or the end of the file for an element of unknown size. */
  end: number;
  /** Offset of the element's id (where the element itself starts). */
  at: number;
  unknownSize: boolean;
}

/** Reads an EBML id: its length is given by the position of the first set bit. */
function readId(bytes: Uint8Array, offset: number): { id: number; length: number } | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  const length = 8 - Math.floor(Math.log2(first));
  if (length > 4 || offset + length > bytes.length) return null;
  let id = 0;
  for (let i = 0; i < length; i++) id = id * 256 + bytes[offset + i];
  return { id, length };
}

/** Reads an EBML size: same encoding, but the marker bit is removed from the value. */
function readSize(bytes: Uint8Array, offset: number): { size: number; length: number; unknown: boolean } | null {
  const first = bytes[offset];
  if (first === undefined || first === 0) return null;
  const length = 8 - Math.floor(Math.log2(first));
  if (offset + length > bytes.length) return null;
  let size = first & ((1 << (8 - length)) - 1);
  let allOnes = size === (1 << (8 - length)) - 1;
  for (let i = 1; i < length; i++) {
    size = size * 256 + bytes[offset + i];
    allOnes &&= bytes[offset + i] === 0xff;
  }
  return { size, length, unknown: allOnes };
}

function readElement(bytes: Uint8Array, offset: number): Element | null {
  const id = readId(bytes, offset);
  if (!id) return null;
  const size = readSize(bytes, offset + id.length);
  if (!size) return null;
  const start = offset + id.length + size.length;
  return { id: id.id, at: offset, start, end: size.unknown ? bytes.length : Math.min(bytes.length, start + size.size), unknownSize: size.unknown };
}

function* children(bytes: Uint8Array, parent: Element): Generator<Element> {
  let offset = parent.start;
  while (offset < parent.end) {
    const element = readElement(bytes, offset);
    if (!element || element.end <= element.start) return;
    yield element;
    offset = element.end;
  }
}

const readUint = (bytes: Uint8Array, el: Element) => {
  let value = 0;
  for (let i = el.start; i < el.end; i++) value = value * 256 + bytes[i];
  return value;
};

function findSegment(bytes: Uint8Array): Element | null {
  let offset = 0;
  const header = readElement(bytes, offset);
  if (!header || header.id !== ID_EBML_HEADER) return null;
  offset = header.end;
  const segment = readElement(bytes, offset);
  return segment && segment.id === ID_SEGMENT ? segment : null;
}

/** What may appear directly inside a Cluster — used to find where one of unknown size ends. */
const CLUSTER_CHILDREN = new Set([ID_TIMECODE, ID_SIMPLE_BLOCK, ID_BLOCK_GROUP, 0x5854, 0xa7, 0xab, 0xaf]);

/**
 * Reads one cluster: its timecode and how far past it the audio runs. MediaRecorder writes clusters
 * of unknown size while it records, so a cluster ends where the next element that cannot belong to
 * it begins.
 */
function readCluster(bytes: Uint8Array, cluster: Element): { furthest: number; end: number } {
  let timecode = 0;
  let furthest = 0;
  let offset = cluster.start;
  const limit = cluster.unknownSize ? bytes.length : cluster.end;
  while (offset < limit) {
    const child = readElement(bytes, offset);
    if (!child || child.end <= child.start) break;
    if (cluster.unknownSize && !CLUSTER_CHILDREN.has(child.id)) break; // the next cluster starts here
    if (child.id === ID_TIMECODE) timecode = readUint(bytes, child);
    else if (child.id === ID_SIMPLE_BLOCK || child.id === ID_BLOCK_GROUP) {
      // A block starts with its track number, then a signed offset from the cluster's timecode.
      const block = child.id === ID_SIMPLE_BLOCK ? child : [...children(bytes, child)].find((c) => c.id === ID_BLOCK);
      const track = block && readSize(bytes, block.start);
      if (block && track) {
        const at = block.start + track.length;
        if (at + 2 <= bytes.length) {
          const relative = new DataView(bytes.buffer, bytes.byteOffset + at, 2).getInt16(0);
          if (relative > furthest) furthest = relative;
        }
      }
    }
    offset = child.end;
  }
  return { furthest: timecode + furthest, end: offset };
}

/**
 * How long the recording runs, in timecode-scale ticks (milliseconds for everything MediaRecorder
 * writes), or null when the file cannot be read.
 */
export function readWebmDuration(bytes: Uint8Array): number | null {
  const segment = findSegment(bytes);
  if (!segment) return null;
  let last: number | null = null;
  let offset = segment.start;
  while (offset < segment.end) {
    const element = readElement(bytes, offset);
    if (!element || element.end <= element.start) break;
    if (element.id === ID_CLUSTER) {
      const cluster = readCluster(bytes, element);
      last = cluster.furthest;
      offset = cluster.end;
      continue;
    }
    if (element.unknownSize) break; // an unknown-size element that is not a cluster: give up
    offset = element.end;
  }
  return last;
}

/** Milliseconds per timecode tick (MediaRecorder always writes 1 ms, but the file decides). */
export function readTimecodeScale(bytes: Uint8Array): number {
  const segment = findSegment(bytes);
  if (segment) {
    for (const element of children(bytes, segment)) {
      if (element.id !== ID_INFO) continue;
      for (const child of children(bytes, element)) {
        if (child.id === ID_TIMECODE_SCALE) return readUint(bytes, child) / 1e6;
      }
    }
  }
  return 1;
}

/** The length of the recording in seconds, or null when the file cannot be read. */
export function webmDurationSeconds(bytes: Uint8Array): number | null {
  const ticks = readWebmDuration(bytes);
  return ticks === null ? null : (ticks * readTimecodeScale(bytes)) / 1000;
}

/** Encodes a number as an EBML size, in as few bytes as it fits. */
function encodeSize(value: number): Uint8Array {
  for (let length = 1; length <= 8; length++) {
    const max = 2 ** (7 * length) - 1;
    if (value >= max) continue;
    const out = new Uint8Array(length);
    let rest = value;
    for (let i = length - 1; i >= 0; i--) {
      out[i] = rest & 0xff;
      rest = Math.floor(rest / 256);
    }
    out[0] |= 1 << (8 - length);
    return out;
  }
  throw new Error("size too large");
}

/**
 * Returns the recording with its duration written into the header, so a player shows a timeline and
 * can seek. Anything unexpected in the file leaves it untouched — a player without a timeline is
 * better than a broken file.
 */
export function withWebmDuration(bytes: Uint8Array, durationTicks = readWebmDuration(bytes)): Uint8Array {
  if (durationTicks === null || durationTicks <= 0) return bytes;
  const segment = findSegment(bytes);
  if (!segment) return bytes;
  const info = [...children(bytes, segment)].find((element) => element.id === ID_INFO);
  if (!info) return bytes;
  if ([...children(bytes, info)].some((child) => child.id === ID_DURATION)) return bytes; // already there

  const duration = new Uint8Array(11); // id (2) + size (1) + 64-bit float (8)
  duration[0] = ID_DURATION >> 8;
  duration[1] = ID_DURATION & 0xff;
  duration[2] = 0x88;
  new DataView(duration.buffer).setFloat64(3, durationTicks);

  const infoContent = bytes.subarray(info.start, info.end);
  const newSize = encodeSize(infoContent.length + duration.length);
  const idLength = 4; // Info's id is four bytes
  const out = new Uint8Array(info.at + idLength + newSize.length + duration.length + infoContent.length + (bytes.length - info.end));
  let offset = 0;
  const put = (part: Uint8Array) => {
    out.set(part, offset);
    offset += part.length;
  };
  put(bytes.subarray(0, info.at + idLength)); // everything up to and including Info's id
  put(newSize);
  put(duration);
  put(infoContent);
  put(bytes.subarray(info.end));
  return out;
}
