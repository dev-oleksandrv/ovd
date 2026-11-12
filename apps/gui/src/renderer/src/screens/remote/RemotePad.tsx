import type { InputBackend, RemoteKey } from '@ovd/core'
import { PadButton } from '../../ui/PadButton'
import { keyDisabledReason, PAD_KEYS } from './remoteView'

interface RemotePadProps {
  backend: InputBackend | null
  flash: RemoteKey | null
  onPress: (key: RemoteKey) => void
}

// The remote: Back, Home and Menu, the D-pad around OK, then rewind, play/pause, fast-forward.
export function RemotePad({ backend, flash, onPress }: RemotePadProps) {
  const button = (key: RemoteKey, opts: { size?: 'md' | 'lg' } = {}) => {
    const pad = PAD_KEYS[key]
    const reason = keyDisabledReason(key, backend)
    return (
      <PadButton
        label={pad.label}
        {...(pad.icon ? { icon: pad.icon } : {})}
        {...(pad.text ? { text: pad.text } : {})}
        {...(opts.size ? { size: opts.size } : {})}
        flash={flash === key}
        disabled={reason !== null}
        {...(reason ? { disabledReason: reason } : {})}
        onPress={() => onPress(key)}
      />
    )
  }
  return (
    <div
      role="group"
      aria-label="Remote"
      className="flex w-[260px] flex-col items-center gap-5 rounded-card border border-line-soft bg-panel px-6 py-6"
    >
      <div className="flex gap-4">
        {button('back')}
        {button('home')}
        {button('menu')}
      </div>
      <div className="grid grid-cols-3 grid-rows-3 place-items-center gap-1.5">
        <span />
        {button('up')}
        <span />
        {button('left')}
        {button('ok', { size: 'lg' })}
        {button('right')}
        <span />
        {button('down')}
        <span />
      </div>
      <div className="flex gap-4">
        {button('rewind')}
        {button('play-pause')}
        {button('fast-forward')}
      </div>
    </div>
  )
}
