const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
// The signature, then the IHDR chunk's length (13) and type, then its width and height.
export const PNG_HEADER_BYTES = 24

// The size of a PNG from its first bytes (the signature and the IHDR chunk); null when they
// aren't a PNG's, as for an empty file or a device error saved under a `.png` name.
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < PNG_HEADER_BYTES) return null
  if (SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, PNG_HEADER_BYTES)
  const type = String.fromCharCode(...bytes.subarray(12, 16))
  if (view.getUint32(8) !== 13 || type !== 'IHDR') return null
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  return width > 0 && height > 0 ? { width, height } : null
}
