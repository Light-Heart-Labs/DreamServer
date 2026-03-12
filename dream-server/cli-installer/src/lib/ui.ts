// ── Terminal UI ─────────────────────────────────────────────────────────────
// Clean, professional terminal output. No CRT gimmicks.

let _verbose = false;

/** Enable verbose/debug output globally. */
export function setVerbose(on: boolean) { _verbose = on; }

/** Check if verbose mode is enabled. */
export function isVerbose(): boolean { return _verbose; }

/** Print debug info — only shown with --verbose. */
export function debug(msg: string) {
  if (!_verbose) return;
  console.log(`  ${c.gray}⦿${c.reset} ${c.dim}${msg}${c.reset}`);
}

const ESC = '\x1b[';

export const c = {
  reset: `${ESC}0m`,
  bold: `${ESC}1m`,
  dim: `${ESC}2m`,
  green: `${ESC}32m`,
  yellow: `${ESC}33m`,
  blue: `${ESC}34m`,
  cyan: `${ESC}36m`,
  red: `${ESC}31m`,
  white: `${ESC}37m`,
  gray: `${ESC}90m`,
  bgGreen: `${ESC}42m`,
  bgRed: `${ESC}41m`,
  bgYellow: `${ESC}43m`,
  bgBlue: `${ESC}44m`,
} as const;

export function ok(msg: string) {
  console.log(`  ${c.green}✓${c.reset} ${msg}`);
}

export function warn(msg: string) {
  console.log(`  ${c.yellow}⚠${c.reset} ${msg}`);
}

export function fail(msg: string) {
  console.log(`  ${c.red}✗${c.reset} ${msg}`);
}

export function info(msg: string) {
  console.log(`  ${c.blue}→${c.reset} ${msg}`);
}

export function step(msg: string) {
  console.log(`  ${c.cyan}▸${c.reset} ${msg}`);
}

export function header(title: string) {
  const line = '─'.repeat(60);
  console.log('');
  console.log(`  ${c.dim}${line}${c.reset}`);
  console.log(`  ${c.bold}${title}${c.reset}`);
  console.log(`  ${c.dim}${line}${c.reset}`);
}

export function phase(num: number, total: number, name: string, estimate?: string) {
  console.log('');
  const est = estimate ? ` ${c.dim}(${estimate})${c.reset}` : '';
  console.log(`  ${c.bold}${c.blue}[${num}/${total}]${c.reset} ${c.bold}${name}${c.reset}${est}`);
  console.log('');
}

export function banner(version: string) {
  console.log('');
  console.log(`  ${c.bold}${c.blue}Dream Server${c.reset} ${c.dim}v${version}${c.reset}`);
  console.log(`  ${c.dim}Local AI · Private · Self-Hosted${c.reset}`);
  console.log('');
}

export function table(rows: [string, string][]) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    console.log(`  ${c.dim}${key.padEnd(maxKey)}${c.reset}  ${value}`);
  }
}

export function box(title: string, rows: [string, string][]) {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  const maxVal = Math.max(...rows.map(([, v]) => v.length));
  const innerWidth = maxKey + maxVal + 4;
  const width = Math.max(innerWidth, title.length + 2);
  const border = '─'.repeat(width + 2);

  console.log('');
  console.log(`  ${c.dim}┌${border}┐${c.reset}`);
  console.log(`  ${c.dim}│${c.reset} ${c.bold}${title.padEnd(width)}${c.reset} ${c.dim}│${c.reset}`);
  console.log(`  ${c.dim}├${border}┤${c.reset}`);
  for (const [key, value] of rows) {
    const line = `${c.dim}${key.padEnd(maxKey)}${c.reset}  ${value}`;
    // Pad accounting for ANSI codes
    const visibleLen = key.length + 2 + value.length;
    const pad = ' '.repeat(Math.max(0, width - visibleLen));
    console.log(`  ${c.dim}│${c.reset} ${line}${pad} ${c.dim}│${c.reset}`);
  }
  console.log(`  ${c.dim}└${border}┘${c.reset}`);
}

export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private i = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private msg: string;

  constructor(msg: string) {
    this.msg = msg;
  }

  start() {
    process.stdout.write(`  ${c.cyan}${this.frames[0]}${c.reset} ${this.msg}`);
    this.interval = setInterval(() => {
      this.i = (this.i + 1) % this.frames.length;
      process.stdout.write(`\r  ${c.cyan}${this.frames[this.i]}${c.reset} ${this.msg}`);
    }, 80);
    return this;
  }

  succeed(msg?: string) {
    this.stop();
    console.log(`\r  ${c.green}✓${c.reset} ${msg ?? this.msg}`);
  }

  fail(msg?: string) {
    this.stop();
    console.log(`\r  ${c.red}✗${c.reset} ${msg ?? this.msg}`);
  }

  private stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    process.stdout.write('\r' + ' '.repeat(this.msg.length + 10) + '\r');
  }
}
