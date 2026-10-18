#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('ovd')
  .description('Open Vega DevTools')
  .version('0.0.0');

program
  .command('hello')
  .description('Smoke test command')
  .option('--json', 'machine-readable output')
  .action((opts: { json?: boolean }) => {
    const result = { ok: true, message: 'OVD CLI is alive' };
    console.log(opts.json ? JSON.stringify(result) : result.message);
  });

program.parse();