import type { SdkState } from '../sdk/useSdk'
import { StatusDot } from '../ui/StatusDot'

// Opens Doctor once it ships (slice 4); until then it only reports.
export function SdkStatus({ sdk }: { sdk: SdkState }) {
  if (sdk.status === 'loading') return null
  return (
    <div className="flex items-center gap-[5px] whitespace-nowrap">
      <StatusDot tone={sdk.status === 'found' ? 'ok' : 'warning'} size={6} />
      {sdk.status === 'found' ? (
        <span>SDK {sdk.version}</span>
      ) : (
        <span className="text-warning">SDK not found</span>
      )}
    </div>
  )
}
