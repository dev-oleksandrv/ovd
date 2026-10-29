import type { SdkState } from '../sdk/useSdk'
import { StatusDot } from '../ui/StatusDot'

interface SdkStatusProps {
  sdk: SdkState
  // Opens Doctor, where the SDK check explains what's wrong.
  onClick: () => void
}

export function SdkStatus({ sdk, onClick }: SdkStatusProps) {
  if (sdk.status === 'loading') return null
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-[5px] whitespace-nowrap hover:text-text"
    >
      <StatusDot tone={sdk.status === 'found' ? 'ok' : 'warning'} size={6} />
      {sdk.status === 'found' ? (
        <span>SDK {sdk.version}</span>
      ) : (
        <span className="text-warning">SDK not found</span>
      )}
    </button>
  )
}
