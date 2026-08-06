import { spawn } from "node:child_process";
import process from "node:process";

const root = new URL("../", import.meta.url);
const commands = [
  { name: "API", args: ["run", "dev:api"], required: true },
  { name: "Web", args: ["run", "dev:web"], required: true },
  { name: "Worker", args: ["run", "dev:worker"], required: false },
  { name: "GBrain", args: ["run", "dev:gbrain"], required: false }
];
const children = [];
let stopping = false;

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 3000).unref();
}

for (const { name, args, required } of commands) {
  const child = spawn("npm", args, {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  children.push(child);
  child.once("error", (error) => {
    console.error(`${name} 启动失败:`, error.message);
    if (required) stop(1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    if (!required) {
      console.warn(`${name} 已退出 (${signal || code || 0})，核心 API 与前端继续运行。`);
      return;
    }
    console.error(`${name} 已退出 (${signal || code || 0})，正在关闭其余核心服务。`);
    stop(code || 1);
  });
}

process.once("SIGINT", () => stop(0));
process.once("SIGTERM", () => stop(0));
