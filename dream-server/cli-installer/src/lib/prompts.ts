// ── Interactive prompts ─────────────────────────────────────────────────────
// readline-based prompts that work correctly in any terminal context.

import { createInterface } from 'node:readline';
import { c } from './ui.ts';

function createRL() {
  return createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

/**
 * Ask a yes/no question. Returns true for yes.
 */
export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const rl = createRL();
  return new Promise((resolve) => {
    rl.question(`  ${c.cyan}?${c.reset} ${question} [${hint}] `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') resolve(defaultYes);
      else resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Ask user to select from a list of options. Returns the 0-based index.
 */
export async function select(
  question: string,
  options: { label: string; description?: string; hint?: string }[],
  defaultIndex = 0,
): Promise<number> {
  console.log('');
  console.log(`  ${c.cyan}?${c.reset} ${question}`);
  console.log('');

  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const num = `${c.bold}[${i + 1}]${c.reset}`;
    const hint = opt.hint ? ` ${c.dim}${opt.hint}${c.reset}` : '';
    const isDefault = i === defaultIndex ? ` ${c.yellow}← default${c.reset}` : '';
    console.log(`  ${num} ${opt.label}${hint}${isDefault}`);
    if (opt.description) {
      console.log(`      ${c.dim}${opt.description}${c.reset}`);
    }
  }

  console.log('');
  const rl = createRL();
  return new Promise((resolve) => {
    rl.question(`  ${c.dim}Select [${defaultIndex + 1}]:${c.reset} `, (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (isNaN(num) || num < 1 || num > options.length) {
        resolve(defaultIndex);
      } else {
        resolve(num - 1);
      }
    });
  });
}

/**
 * TUI multi-select picker. Arrow keys to navigate, space to toggle, enter to confirm.
 * Shows all options at once with checkboxes.
 */
export async function multiSelect(
  question: string,
  options: { label: string; description?: string; checked: boolean }[],
): Promise<boolean[]> {
  const selected = options.map((o) => o.checked);
  let cursor = 0;
  const totalLines = options.length + 2; // header + blank + options

  const renderLine = (i: number) => {
    const check = selected[i] ? `${c.green}✓${c.reset}` : `${c.dim}○${c.reset}`;
    const pointer = i === cursor ? `${c.cyan}❯${c.reset}` : ' ';
    const label = i === cursor ? `${c.bold}${options[i].label}${c.reset}` : options[i].label;
    const desc = options[i].description ? ` ${c.dim}${options[i].description}${c.reset}` : '';
    return `  ${pointer} [${check}] ${label}${desc}`;
  };

  const render = () => {
    // Move cursor up to redraw
    process.stdout.write(`\x1b[${totalLines}A\x1b[J`);
    console.log(`  ${c.cyan}?${c.reset} ${question} ${c.dim}(↑↓ move, space toggle, enter confirm)${c.reset}`);
    console.log('');
    for (let i = 0; i < options.length; i++) {
      console.log(renderLine(i));
    }
  };

  // Initial render
  console.log(`  ${c.cyan}?${c.reset} ${question} ${c.dim}(↑↓ move, space toggle, enter confirm)${c.reset}`);
  console.log('');
  for (let i = 0; i < options.length; i++) {
    console.log(renderLine(i));
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve(selected);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();

    const onData = (buf: Buffer) => {
      const key = buf.toString();

      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % options.length;
        render();
      } else if (key === ' ') {
        selected[cursor] = !selected[cursor];
        render();
      } else if (key === '\r' || key === '\n') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        stdin.pause();
        resolve(selected);
      } else if (key === '\x03') {
        stdin.setRawMode(false);
        process.exit(130);
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Ask for free-form text input.
 */
export async function input(question: string, defaultValue?: string): Promise<string> {
  const hint = defaultValue ? ` ${c.dim}(${defaultValue})${c.reset}` : '';
  const rl = createRL();
  return new Promise((resolve) => {
    rl.question(`  ${c.cyan}?${c.reset} ${question}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}
