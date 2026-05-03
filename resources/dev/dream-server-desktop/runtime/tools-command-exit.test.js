const assert = require("assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
process.env.DREAM_DISABLE_PTY = "1";
const { executeTool } = require("./tools");

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dream-command-exit-"));
  try {
    await fn(root);
  } finally {
    await executeTool(
      {
        type: "stop_all_local_activity",
        reason: "command_exit_test_cleanup"
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    ).catch(() => null);
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testRunCommandRejectsNonZeroByDefault() {
  await withTempWorkspace(async (root) => {
    await assert.rejects(
      () =>
        executeTool(
          {
            type: "run_command",
            command: process.execPath,
            args: ["-e", "process.exit(7)"],
            timeoutMs: 10000
          },
          {
            workspaceRoot: root,
            fullAccessMode: true
          }
        ),
      /falhou com codigo 7|finalizado com codigo 7/
    );
  });
}

async function testRunCommandCanExplicitlyAllowNonZero() {
  await withTempWorkspace(async (root) => {
    const result = await executeTool(
      {
        type: "run_command",
        command: process.execPath,
        args: ["-e", "process.exit(7)"],
        allowNonZero: true,
        timeoutMs: 10000
      },
      {
        workspaceRoot: root,
        fullAccessMode: true
      }
    );

    assert.match(result, /finalizado com codigo 7/);
  });
}

async function testTerminalExecRejectsNonZeroByDefault() {
  await withTempWorkspace(async (root) => {
    await executeTool(
      {
        type: "terminal_open",
        session: "exit-test",
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
            session: "exit-test",
            command: "& node -e \"process.exit(9)\"",
            timeoutMs: 10000
          },
          {
            workspaceRoot: root,
            fullAccessMode: true
          }
        ),
      /falhou com codigo 9|finalizado com codigo 9/
    );
  });
}

async function main() {
  await testRunCommandRejectsNonZeroByDefault();
  console.log("ok - testRunCommandRejectsNonZeroByDefault");
  await testRunCommandCanExplicitlyAllowNonZero();
  console.log("ok - testRunCommandCanExplicitlyAllowNonZero");
  await testTerminalExecRejectsNonZeroByDefault();
  console.log("ok - testTerminalExecRejectsNonZeroByDefault");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
