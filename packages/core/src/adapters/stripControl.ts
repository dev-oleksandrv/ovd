// C0 (U+0000–U+001F, tab excepted), DEL and C1 (U+0080–U+009F) control characters.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F]/g

// Text an app wrote on the device (log lines, a crash report) goes to the host terminal and the
// desktop as is, so an ANSI or OSC escape sequence in it would act there. Removing the control
// characters, ESC and the C1 CSI/OSC included, leaves the sequence inert; a tab survives.
export function stripControl(text: string): string {
  return text.replace(CONTROL, '')
}
