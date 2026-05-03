const { spawn } = require("child_process");
const path = require("path");

function runGit(args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const stdout = [];
    const stderr = [];
    const child = spawn("git", args, {
      cwd: options.cwd || process.cwd(),
      windowsHide: true
    });

    const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs || 120000), 300000));
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      try {
        child.kill();
      } catch {}
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout?.on("data", (chunk) => stdout.push(chunk));
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("close", (code) => {
      clearTimeout(timer);
      if (didTimeout) {
        reject(new Error("O comando git excedeu o tempo limite."));
        return;
      }
      resolve({
        code: Number(code || 0),
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim()
      });
    });
  });
}

async function ensureGitWorkspace(cwd) {
  const result = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  if (result.code !== 0 || !result.stdout) {
    throw new Error(result.stderr || "Este caminho nao esta dentro de um repositorio git.");
  }
  return path.normalize(result.stdout.split(/\r?\n/)[0].trim());
}

async function gitStatus(cwd) {
  await ensureGitWorkspace(cwd);
  const result = await runGit(["status", "--short", "--branch"], { cwd });
  if (result.code !== 0) {
    throw new Error(result.stderr || "Falha ao consultar git status.");
  }
  return result.stdout || "(sem alteracoes)";
}

async function gitCreateBranch(cwd, branchName, fromRef = "HEAD", checkout = false) {
  await ensureGitWorkspace(cwd);
  const branch = String(branchName || "").trim();
  if (!branch) {
    throw new Error("git_create_branch exige um nome de branch.");
  }
  const args = checkout
    ? ["switch", "-c", branch, fromRef]
    : ["branch", branch, fromRef];
  const result = await runGit(args, { cwd });
  if (result.code !== 0) {
    throw new Error(result.stderr || "Falha ao criar a branch.");
  }
  return checkout
    ? `Branch criada e ativada: ${branch} (${fromRef}).`
    : `Branch criada: ${branch} (${fromRef}).`;
}

function parseWorktreeList(output) {
  const records = [];
  const blocks = String(output || "").split(/\r?\n\r?\n/).filter(Boolean);
  for (const block of blocks) {
    const record = {
      path: "",
      branch: "",
      head: "",
      bare: false,
      detached: false
    };
    for (const line of block.split(/\r?\n/)) {
      const [key, ...rest] = line.split(" ");
      const value = rest.join(" ").trim();
      if (key === "worktree") record.path = path.normalize(value);
      if (key === "branch") record.branch = value.replace(/^refs\/heads\//, "");
      if (key === "HEAD") record.head = value;
      if (key === "bare") record.bare = true;
      if (key === "detached") record.detached = true;
    }
    if (record.path) {
      records.push(record);
    }
  }
  return records;
}

async function gitWorktreeList(cwd) {
  await ensureGitWorkspace(cwd);
  const result = await runGit(["worktree", "list", "--porcelain"], { cwd });
  if (result.code !== 0) {
    throw new Error(result.stderr || "Falha ao listar worktrees.");
  }
  return parseWorktreeList(result.stdout);
}

async function gitWorktreeAdd(cwd, targetPath, branchName, options = {}) {
  const repoRoot = await ensureGitWorkspace(cwd);
  const rawTarget = String(targetPath || "").trim();
  if (!rawTarget) {
    throw new Error("git_worktree_add exige um caminho de destino.");
  }
  const resolvedTarget = path.resolve(cwd, rawTarget);
  const branch = String(branchName || "").trim();
  const fromRef = String(options.fromRef || "HEAD").trim() || "HEAD";
  const createBranch = Boolean(options.createBranch);
  const args = ["worktree", "add"];
  if (createBranch) {
    if (!branch) {
      throw new Error("git_worktree_add com createBranch=true exige branch.");
    }
    args.push("-b", branch, resolvedTarget, fromRef);
  } else if (branch) {
    args.push(resolvedTarget, branch);
  } else {
    args.push(resolvedTarget);
  }
  const result = await runGit(args, { cwd: repoRoot, timeoutMs: 300000 });
  if (result.code !== 0) {
    throw new Error(result.stderr || "Falha ao adicionar worktree.");
  }
  return `Worktree adicionada: ${resolvedTarget}${branch ? ` (${branch})` : ""}.`;
}

async function gitWorktreeRemove(cwd, targetPath, options = {}) {
  const repoRoot = await ensureGitWorkspace(cwd);
  const rawTarget = String(targetPath || "").trim();
  if (!rawTarget) {
    throw new Error("git_worktree_remove exige um caminho.");
  }
  const resolvedTarget = path.resolve(cwd, rawTarget);
  const args = ["worktree", "remove"];
  if (options.force) {
    args.push("--force");
  }
  args.push(resolvedTarget);
  const result = await runGit(args, {
    cwd: repoRoot,
    timeoutMs: 300000
  });
  if (result.code !== 0) {
    throw new Error(result.stderr || "Falha ao remover worktree.");
  }
  return `Worktree removida: ${resolvedTarget}.`;
}

module.exports = {
  ensureGitWorkspace,
  gitCreateBranch,
  gitStatus,
  gitWorktreeAdd,
  gitWorktreeList,
  gitWorktreeRemove
};
