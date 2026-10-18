import type { JSX } from 'react'

const devices = [
  {
    name: 'Fire TV Stick 4K Select',
    serial: 'G000XXXXXXXXXXXX',
    arch: 'armv7',
    connection: 'USB',
    status: 'online'
  },
  {
    name: 'Vega Virtual Device',
    serial: 'emulator-5554',
    arch: 'aarch64',
    connection: 'local',
    status: 'stopped'
  }
]

function App(): JSX.Element {
  return (
    <div className="shell">
      <aside className="sidebar">
        <h1>OVD</h1>
        <nav>
          <a className="active">Devices</a>
          <a>Apps</a>
          <a>Logs</a>
          <a>Remote</a>
        </nav>
      </aside>
      <main className="content">
        <h2>Devices</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Serial</th>
              <th>Arch</th>
              <th>Connection</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={d.serial}>
                <td>{d.name}</td>
                <td>{d.serial}</td>
                <td>{d.arch}</td>
                <td>{d.connection}</td>
                <td className={d.status}>{d.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="hint">Mock data. Not connected to the SDK yet.</p>
      </main>
    </div>
  )
}

export default App
