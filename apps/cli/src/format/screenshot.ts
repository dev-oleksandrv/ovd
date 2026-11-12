import type { ScreenshotResult } from '@ovd/core'

export type ScreenshotOutcome = ScreenshotResult & { copied: boolean }

// "Saved /…/vega-virtual-device-20261112-021100.png (1920×1080) from Vega Virtual Device (grpc)".
export function savedLine(result: ScreenshotOutcome): string {
  const copied = result.copied ? ' · copied to the clipboard' : ''
  return `Saved ${result.path} (${result.width}×${result.height}) from ${result.target.name} (${result.backend})${copied}\n`
}
