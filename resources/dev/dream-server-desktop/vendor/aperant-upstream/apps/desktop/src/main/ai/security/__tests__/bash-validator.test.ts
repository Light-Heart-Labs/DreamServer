/**
 * Tests for Bash Validator
 *
 * Tests the denylist-based security model:
 * - Commands in BLOCKED_COMMANDS are always denied
 * - Commands with per-command validators are validated for dangerous patterns
 * - All other commands are allowed by default
 */

import { describe, expect, it } from 'vitest';

import {
  BLOCKED_COMMANDS,
  bashSecurityHook,
  isCommandBlocked,
  validateCommand,
} from '../bash-validator';

// ---------------------------------------------------------------------------
// isCommandBlocked
// ---------------------------------------------------------------------------

describe('isCommandBlocked', () => {
  it('blocks commands in the static denylist', () => {
    const deniedCommands = [
      'sudo',
      'su',
      'shutdown',
      'reboot',
      'halt',
      'poweroff',
      'init',
      'mkfs',
      'fdisk',
      'parted',
      'gdisk',
      'dd',
      'chown',
      'iptables',
      'ip6tables',
      'nft',
      'ufw',
      'nmap',
      'systemctl',
      'service',
      'crontab',
      'mount',
      'umount',
      'useradd',
      'userdel',
      'usermod',
      'groupadd',
      'groupdel',
      'passwd',
      'visudo',
    ];

    for (const cmd of deniedCommands) {
      const [notBlocked] = isCommandBlocked(cmd);
      expect(notBlocked, `Expected '${cmd}' to be blocked`).toBe(false);
    }
  });

  it('allows common development commands', () => {
    const allowedCommands = [
      'ls',
      'cat',
      'grep',
      'echo',
      'pwd',
      'cd',
      'mkdir',
      'rm',
      'cp',
      'mv',
      'git',
      'npm',
      'node',
      'python',
      'curl',
      'wget',
      'find',
      'make',
      'cargo',
      'go',
    ];

    for (const cmd of allowedCommands) {
      const [notBlocked] = isCommandBlocked(cmd);
      expect(notBlocked, `Expected '${cmd}' to be allowed`).toBe(true);
    }
  });

  it('returns a descriptive reason for blocked commands', () => {
    const [blocked, reason] = isCommandBlocked('sudo');
    expect(blocked).toBe(false);
    expect(reason).toContain('sudo');
    expect(reason).toContain('blocked');
  });

  it('BLOCKED_COMMANDS set is non-empty', () => {
    expect(BLOCKED_COMMANDS.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// validateCommand (denylist model — profile arg is ignored)
// ---------------------------------------------------------------------------

describe('validateCommand', () => {
  it('allows common development commands', () => {
    const cmds = ['ls', 'cat', 'grep', 'echo', 'pwd', 'mkdir', 'cp', 'mv'];
    for (const cmd of cmds) {
      const [allowed] = validateCommand(cmd);
      expect(allowed, `Expected '${cmd}' to be allowed`).toBe(true);
    }
  });

  it('allows git commands', () => {
    const [allowed] = validateCommand('git status');
    expect(allowed).toBe(true);
  });

  it('allows curl (not in denylist)', () => {
    const [allowed] = validateCommand('curl https://example.com');
    expect(allowed).toBe(true);
  });

  it('allows npm commands', () => {
    const [allowed] = validateCommand('npm install');
    expect(allowed).toBe(true);
  });

  it('blocks denylist commands', () => {
    const deniedCmds = ['sudo ls', 'shutdown now', 'dd if=/dev/zero of=/dev/sda'];
    for (const cmd of deniedCmds) {
      const [allowed] = validateCommand(cmd);
      expect(allowed, `Expected '${cmd}' to be blocked`).toBe(false);
    }
  });

  it('allows rm with safe arguments', () => {
    const [allowed] = validateCommand('rm file.txt');
    expect(allowed).toBe(true);
  });

  it('blocks rm with dangerous targets', () => {
    const [allowed] = validateCommand('rm -rf /');
    expect(allowed).toBe(false);
  });

  it('allows pipelines of safe commands', () => {
    const [allowed] = validateCommand('cat file | grep pattern | wc -l');
    expect(allowed).toBe(true);
  });

  it('blocks pipelines containing a denylist command', () => {
    const [allowed] = validateCommand('ls && sudo rm -rf /');
    expect(allowed).toBe(false);
  });

  it('blocks pipelines where any command is in the denylist', () => {
    const [allowed] = validateCommand('ls | systemctl stop nginx');
    expect(allowed).toBe(false);
  });

  it('accepts an optional profile argument for backward compat (ignored)', () => {
    const fakeProfile = {
      baseCommands: new Set<string>(),
      stackCommands: new Set<string>(),
      scriptCommands: new Set<string>(),
      customCommands: new Set<string>(),
      customScripts: { shellScripts: [] },
      getAllAllowedCommands: () => new Set<string>(),
    };
    // Previously an empty profile would block everything; now curl is allowed
    const [allowed] = validateCommand('curl https://example.com', fakeProfile);
    expect(allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bashSecurityHook
// ---------------------------------------------------------------------------

describe('bashSecurityHook', () => {
  it('allows non-Bash tool calls without a profile', () => {
    const result = bashSecurityHook({ toolName: 'Read', toolInput: { path: '/etc/passwd' } });
    expect(result).toEqual({});
  });

  it('denies null toolInput', () => {
    const result = bashSecurityHook({ toolName: 'Bash', toolInput: null });
    expect('hookSpecificOutput' in result).toBe(true);
    if ('hookSpecificOutput' in result) {
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    }
  });

  it('allows empty command', () => {
    const result = bashSecurityHook({ toolName: 'Bash', toolInput: { command: '' } });
    expect(result).toEqual({});
  });

  it('allows commands not in the denylist', () => {
    const commands = [
      'ls -la',
      'curl https://example.com',
      'npm install',
      'git status',
      'mkdir -p /tmp/foo',
      'python3 script.py',
    ];
    for (const command of commands) {
      const result = bashSecurityHook({ toolName: 'Bash', toolInput: { command } });
      expect(result, `Expected '${command}' to be allowed`).toEqual({});
    }
  });

  it('denies commands in the BLOCKED_COMMANDS denylist', () => {
    const blockedCommands = [
      'sudo apt-get install vim',
      'shutdown now',
      'reboot',
      'dd if=/dev/urandom of=/dev/sda',
      'systemctl stop nginx',
      'useradd hacker',
      'iptables -F',
      'mount /dev/sdb /mnt',
    ];
    for (const command of blockedCommands) {
      const result = bashSecurityHook({ toolName: 'Bash', toolInput: { command } });
      expect('hookSpecificOutput' in result, `Expected '${command}' to be blocked`).toBe(true);
      if ('hookSpecificOutput' in result) {
        expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
      }
    }
  });

  it('denies non-object toolInput', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: 'not an object' as never,
    });
    expect('hookSpecificOutput' in result).toBe(true);
  });

  it('allows chained safe commands', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: 'ls && pwd && echo done' },
    });
    expect(result).toEqual({});
  });

  it('denies when any chained command is in the denylist', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: 'ls && sudo rm -rf /' },
    });
    expect('hookSpecificOutput' in result).toBe(true);
  });

  it('accepts an optional profile argument for backward compat (ignored)', () => {
    const emptyProfile = {
      baseCommands: new Set<string>(),
      stackCommands: new Set<string>(),
      scriptCommands: new Set<string>(),
      customCommands: new Set<string>(),
      customScripts: { shellScripts: [] },
      getAllAllowedCommands: () => new Set<string>(),
    };
    // Previously an empty profile would block everything — now curl is allowed
    const result = bashSecurityHook(
      { toolName: 'Bash', toolInput: { command: 'curl https://example.com' } },
      emptyProfile,
    );
    expect(result).toEqual({});
  });

  it('still runs per-command validators for dangerous patterns within allowed commands', () => {
    // rm is not in the denylist, but the rm validator blocks dangerous targets
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: 'rm -rf /' },
    });
    expect('hookSpecificOutput' in result).toBe(true);
    if ('hookSpecificOutput' in result) {
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    }
  });

  it('blocks git identity config changes via per-command validator', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: 'git config user.email fake@example.com' },
    });
    expect('hookSpecificOutput' in result).toBe(true);
    if ('hookSpecificOutput' in result) {
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
    }
  });

  it('blocks denylist commands inside bash -c strings', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: "bash -c 'sudo rm -rf /'" },
    });
    expect('hookSpecificOutput' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pkill / killall — denylist-based process management
// ---------------------------------------------------------------------------

describe('pkill validator (denylist model)', () => {
  it('allows killing any dev/framework process', () => {
    const allowedCommands = [
      'pkill vite',
      'pkill next',
      'pkill remix',
      'pkill astro',
      'pkill nuxt',
      'pkill webpack',
      'pkill node',
      'pkill -f "npm run dev"',
      'pkill -f "next dev"',
      'pkill -f "python manage.py runserver"',
      'pkill tsx',
      'pkill bun',
      'pkill deno',
      'pkill cargo',
      'pkill ruby',
      'pkill rails',
      'pkill flask',
      'pkill uvicorn',
      'pkill my-custom-server',
      'pkill some-random-script',
    ];
    for (const cmd of allowedCommands) {
      const result = bashSecurityHook({ toolName: 'Bash', toolInput: { command: cmd } });
      expect(result, `Expected '${cmd}' to be allowed`).toEqual({});
    }
  });

  it('blocks killing system-critical processes', () => {
    const blockedTargets = [
      'pkill systemd',
      'pkill launchd',
      'pkill Finder',
      'pkill Dock',
      'pkill WindowServer',
      'pkill sshd',
      'pkill init',
      'pkill loginwindow',
      'pkill Xorg',
      'pkill gnome-shell',
      'pkill electron',
      'pkill Electron',
    ];
    for (const cmd of blockedTargets) {
      const result = bashSecurityHook({ toolName: 'Bash', toolInput: { command: cmd } });
      expect('hookSpecificOutput' in result, `Expected '${cmd}' to be blocked`).toBe(true);
    }
  });

  it('blocks pkill -u (kill by user — too broad)', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: 'pkill -u root' },
    });
    expect('hookSpecificOutput' in result).toBe(true);
  });

  it('blocks bare pkill with no target', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: 'pkill' },
    });
    expect('hookSpecificOutput' in result).toBe(true);
  });

  it('allows killall for non-system processes', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: 'killall vite' },
    });
    expect(result).toEqual({});
  });

  it('blocks killall for system processes', () => {
    const result = bashSecurityHook({
      toolName: 'Bash',
      toolInput: { command: 'killall Finder' },
    });
    expect('hookSpecificOutput' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// chmod — denylist-based (blocks setuid/setgid only)
// ---------------------------------------------------------------------------

describe('chmod validator (denylist model)', () => {
  it('allows all standard permission modes', () => {
    const allowedCommands = [
      'chmod 755 script.sh',
      'chmod 644 file.txt',
      'chmod 700 private/',
      'chmod 600 secret.key',
      'chmod 777 shared/',
      'chmod 775 dir/',
      'chmod 664 data.csv',
      'chmod 744 build.sh',
      'chmod 750 bin/',
      'chmod 440 readonly.conf',
      'chmod 400 id_rsa',
      'chmod 666 socket',
      'chmod +x script.sh',
      'chmod a+x binary',
      'chmod u+x test.sh',
      'chmod o+w shared/',
      'chmod g+rw groupdir/',
      'chmod u+rw,g+r file',
      'chmod -R 755 dist/',
    ];
    for (const cmd of allowedCommands) {
      const result = bashSecurityHook({ toolName: 'Bash', toolInput: { command: cmd } });
      expect(result, `Expected '${cmd}' to be allowed`).toEqual({});
    }
  });

  it('blocks setuid modes (privilege escalation)', () => {
    const blockedCommands = [
      'chmod 4755 binary',     // setuid
      'chmod 2755 binary',     // setgid
      'chmod 6755 binary',     // setuid + setgid
      'chmod +s binary',       // symbolic setuid
      'chmod u+s binary',      // user setuid
      'chmod g+s dir/',        // group setgid
    ];
    for (const cmd of blockedCommands) {
      const result = bashSecurityHook({ toolName: 'Bash', toolInput: { command: cmd } });
      expect('hookSpecificOutput' in result, `Expected '${cmd}' to be blocked`).toBe(true);
    }
  });
});
