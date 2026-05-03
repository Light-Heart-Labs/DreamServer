const assert = require("assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
process.env.DREAM_DISABLE_PTY = "1";
const { executeTool, getTerminalSessionSnapshots } = require("./tools");

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dream-terminal-"));
  try {
    await fn(root);
  } finally {
    await executeTool(
      {
        type: "stop_all_local_activity",
        reason: "terminal_state_test_cleanup"
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    ).catch(() => null);
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testTerminalTracksPromptAndHistory() {
  await withTempWorkspace(async (root) => {
    await executeTool(
      {
        type: "terminal_open",
        session: "state-test",
        shell: "powershell",
        cwd: root
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    );

    const result = await executeTool(
      {
        type: "terminal_exec",
        session: "state-test",
        command: 'Write-Output "dream-terminal-ok"',
        timeoutMs: 10000
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    );

    assert.match(result, /dream-terminal-ok/);
    const session = getTerminalSessionSnapshots().find((item) => item.id === "state-test");
    assert.ok(session);
    assert.equal(session.alive, true);
    assert.equal(session.promptState, "idle");
    assert.equal(session.currentCommand, null);
    assert.equal(session.lastExitCode, 0);
    assert.ok(session.history.length >= 1);
    assert.ok(Number(session.history.at(-1).durationMs || 0) >= 0);
  });
}

async function testTerminalTimeoutKillsTreeAndRecordsState() {
  await withTempWorkspace(async (root) => {
    await executeTool(
      {
        type: "terminal_open",
        session: "timeout-test",
        shell: "powershell",
        cwd: root
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    );

    await assert.rejects(
      () =>
        executeTool(
          {
            type: "terminal_exec",
            session: "timeout-test",
            command: "Start-Sleep -Seconds 3",
            timeoutMs: 1000,
            stallAfterMs: 1000
          },
          {
            workspaceRoot: root,
            fullAccessMode: true
          }
        ),
      /excedeu 1s|interrompida/
    );

    const session = getTerminalSessionSnapshots().find((item) => item.id === "timeout-test");
    assert.ok(session);
    assert.equal(session.alive, false);
    assert.equal(session.promptState, "closed");
    assert.ok(session.killResult);
    assert.equal(session.stopReason, "timeout de comando");
    assert.ok(session.history.some((entry) => entry.code === null));
  });
}

async function main() {
  await testTerminalTracksPromptAndHistory();
  console.log("ok - testTerminalTracksPromptAndHistory");
  await testTerminalTimeoutKillsTreeAndRecordsState();
  console.log("ok - testTerminalTimeoutKillsTreeAndRecordsState");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
