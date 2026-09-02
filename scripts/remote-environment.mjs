/* global console, process */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(root, "remote-environment.json");
const mode = process.argv[2] ?? "check";
const role = process.env.REMOTE_HOST_ROLE || "development";
const platform = process.platform === "win32"
  ? "windows"
  : process.platform === "darwin"
    ? "macos"
    : "linux";

function fail(message) {
  console.error(`[remote] ERROR: ${message}`);
  process.exitCode = 1;
}

function info(message) {
  console.log(`[remote] ${message}`);
}

function warn(message) {
  console.warn(`[remote] WARNING: ${message}`);
}

function run(command, { capture = false } = {}) {
  const result = spawnSync(command, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    shell: true,
    stdio: capture ? "pipe" : "inherit",
  });
  return result;
}

function output(command) {
  const result = run(command, { capture: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function commandExists(command) {
  const probe = process.platform === "win32"
    ? `where.exe ${command}`
    : `command -v ${command}`;
  return run(probe, { capture: true }).status === 0;
}

if (!existsSync(configPath)) {
  fail(`Missing ${configPath}`);
  process.exit();
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
if (config.schemaVersion !== 1) {
  fail(`Unsupported schemaVersion: ${config.schemaVersion}`);
  process.exit();
}

function activeRequirements() {
  const roleConfig = config.roles?.[role] ?? {};
  return {
    commands: [...new Set([
      ...(config.requiredCommands ?? []),
      ...(roleConfig.requiredCommands ?? []),
    ])],
    env: [...new Set([
      ...(config.requiredEnvironment ?? []),
      ...(roleConfig.requiredEnvironment ?? []),
    ])],
  };
}

function check() {
  info(`Project: ${config.project}`);
  info(`Platform: ${platform}; role: ${role}`);

  if (!existsSync(resolve(root, ".git"))) {
    fail("This checkout is not a Git repository.");
  } else {
    const branch = output("git branch --show-current");
    const commit = output("git rev-parse HEAD");
    const remotes = output("git remote");
    const dirty = output("git status --short");
    info(`Git branch: ${branch || "detached"}`);
    info(`Git commit: ${commit || "uncommitted repository"}`);
    if (branch && config.baselineBranch && branch !== config.baselineBranch) {
      warn(`Current branch differs from baseline ${config.baselineBranch}; confirm this is an intentional task branch.`);
    }
    if (!remotes) warn("No Git remote is configured.");
    if (dirty) warn("The working tree contains uncommitted changes.");
  }

  const expectedNodeMajor = Number(config.runtime?.nodeMajor);
  const actualNodeMajor = Number(process.versions.node.split(".")[0]);
  if (expectedNodeMajor && actualNodeMajor !== expectedNodeMajor) {
    fail(`Node ${expectedNodeMajor}.x is required; found ${process.versions.node}.`);
  } else {
    info(`Node: ${process.versions.node}`);
  }

  const requirements = activeRequirements();
  for (const command of requirements.commands) {
    if (commandExists(command)) info(`Command available: ${command}`);
    else fail(`Required command is unavailable for role ${role}: ${command}`);
  }

  for (const name of requirements.env) {
    if (process.env[name]) info(`Environment configured: ${name}`);
    else fail(`Required environment variable is not configured: ${name}`);
  }

  const optional = config.roles?.[role]?.optionalCommands ?? [];
  for (const command of optional) {
    if (!commandExists(command)) warn(`Optional command unavailable: ${command}`);
  }

  info(`Code truth: ${config.sourcesOfTruth?.code ?? "not defined"}`);
  info(`Operations truth: ${config.sourcesOfTruth?.operations ?? "not defined"}`);
  info(`Production data truth: ${config.sourcesOfTruth?.productionData ?? "not defined"}`);
  return process.exitCode ? 1 : 0;
}

function configuredCommands(section) {
  return [
    ...(section?.all ?? []),
    ...(section?.[platform] ?? []),
  ];
}

function executeCommands(commands, label) {
  for (const command of commands) {
    info(`${label}: ${command}`);
    const result = run(command);
    if (result.status !== 0) {
      fail(`${label} failed: ${command}`);
      return false;
    }
  }
  return true;
}

if (mode === "check") {
  check();
} else if (mode === "bootstrap") {
  if (check() === 0) {
    executeCommands(configuredCommands(config.bootstrapCommands), "bootstrap");
  }
} else if (mode === "verify") {
  if (check() === 0) {
    executeCommands(config.verifyCommands ?? [], "verify");
  }
} else if (mode === "guard-deploy") {
  const allowed = config.deploy?.authorizedRoles ?? [];
  if (!allowed.includes(role)) {
    fail(`Role ${role} is not authorized to deploy. Allowed roles: ${allowed.join(", ") || "none"}.`);
  } else if (check() === 0) {
    info(`Deploy guard passed for role ${role}.`);
  }
} else {
  fail(`Unknown mode: ${mode}. Use check, bootstrap, verify, or guard-deploy.`);
}
