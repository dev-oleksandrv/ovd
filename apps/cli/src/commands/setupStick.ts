import type { Command } from 'commander'
import { isOvdError, normalizeCode, OvdError, type Device } from '@ovd/core'
import type { CliDeps } from '../program.js'
import { details } from '../format/devices.js'
import { report } from '../report.js'
import { reportContext } from './context.js'

interface SetupOptions {
  code?: string
  vendor?: string
  wifi?: boolean
}

const TV_STEPS = `On the TV:
  1. Open Settings → My Fire TV → About.
  2. Select the device name 7 times, until the TV says “You are now a developer”.
  3. Press Back, then Developer options → Developer Mode → Continue.
  4. The TV shows a code. Leave it on screen.
`

// The new-stick wizard (Stage 1.5, ADR 0009): sign in, enable with the TV's code, wait for the
// stick on USB. In JSON mode each finished step is a JSON line before the result, so a script
// or agent can show the sign-in link while `vega devmode login` waits.
export function registerSetupStick(
  program: Command,
  deps: CliDeps,
  setExitCode: (code: number) => void
): void {
  program
    .command('setup-stick')
    .description('Turn on Developer Mode on a new Fire TV stick and connect it over USB')
    .option('--code <code>', 'the code the TV shows under Developer Mode')
    .option('--vendor <id>', 'vendor ID, when the developer account has several')
    .option('--wifi', 'stop once Developer Mode is on; pair it next with ovd pair')
    .action(async (opts: SetupOptions, cmd: Command) => {
      const ctx = reportContext(cmd, deps, setExitCode)
      const say = (text: string): void => ctx.output.stderr(text)
      const event = (step: string, status: string, extra: object = {}): void => {
        if (ctx.json) ctx.output.stdout(`${JSON.stringify({ step, status, ...extra })}\n`)
      }

      async function askCode(): Promise<string> {
        for (;;) {
          const answer = (await deps.prompt?.('Code from the TV: ')) ?? ''
          try {
            return normalizeCode(answer)
          } catch (error) {
            if (!isOvdError(error)) throw error
            say(`${error.message}. ${error.hint}\n`)
          }
        }
      }

      async function setup(signal: AbortSignal): Promise<{ device: Device | null }> {
        // A wrong --code fails before the sign-in, not after.
        let code = opts.code === undefined ? undefined : normalizeCode(opts.code)
        if (code === undefined && !deps.prompt) {
          throw new OvdError(
            'INVALID_CODE',
            'No code from the TV',
            'Pass it with --code <code>, or run ovd setup-stick in a terminal'
          )
        }
        const ovd = deps.ovd()
        if (code === undefined) {
          say(TV_STEPS)
          await deps.prompt?.('Press Enter when the TV shows the code ')
        }

        say('Checking the Amazon Developer sign-in…\n')
        await ovd.devmode.login({
          signal,
          onPrompt: (prompt) => {
            event('login', 'pending', prompt)
            say(
              `Open ${prompt.verificationUri} in your browser and enter the code ${prompt.userCode}\n` +
                'Waiting for sign-in in your browser…\n'
            )
          }
        })
        event('login', 'done')
        say('Signed in to Amazon Developer Services\n')

        code ??= await askCode()
        say('Enabling Developer Mode…\n')
        await ovd.devmode.enableDevice({
          code,
          ...(opts.vendor === undefined ? {} : { vendor: opts.vendor })
        })
        event('enable', 'done')
        if (opts.wifi === true) return { device: null }

        say('The stick is rebooting. Waiting for it to appear on USB…\n')
        event('connect', 'waiting')
        return { device: await ovd.devmode.waitForStick({ signal }) }
      }

      // Ctrl+C stops `vega devmode login` and the wait instead of leaving them behind.
      async function cancellable(): Promise<{ device: Device | null }> {
        const controller = new AbortController()
        const dispose = deps.onInterrupt(() => controller.abort())
        try {
          return await setup(controller.signal)
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            throw new OvdError('COMMAND_FAILED', 'Cancelled', 'Run ovd setup-stick again')
          }
          throw error
        } finally {
          dispose()
        }
      }

      await report(ctx, cancellable, {
        json: (result) => result,
        human: ({ device }) =>
          device
            ? `${device.name} · ${device.serial ?? device.id} · ${details(device)} — now in Devices\n`
            : 'Developer Mode is on. Pair the stick over Wi-Fi: ovd pair --usb, or ovd pair <ip>[:port]\n'
      })
    })
}
