// A table-based CRC-32 (IEEE, as zip uses). `zlib.crc32` only exists from
// Node 22.2 and the engines field says `>=22`, so core computes it itself.
const TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/** CRC-32 of `data`. Pass the result as `previous` to continue over more chunks. */
export function crc32(data: Uint8Array, previous = 0): number {
  let c = ~previous >>> 0
  for (let i = 0; i < data.length; i++) {
    // The index is masked to 0-255, so the table read is always defined.
    c = (TABLE[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8)
  }
  return ~c >>> 0
}
