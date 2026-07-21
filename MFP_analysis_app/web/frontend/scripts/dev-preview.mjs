import { spawnSync } from "node:child_process";
import process from "node:process";

const bad = /['#?]/;
const cwd = process.cwd();

if (bad.test(cwd)) {
  console.warn(
    "\n⚠  Vite dev mode fails when the project path contains ', #, or ? on Windows.",
  );
  console.warn(`   Current path: ${cwd}`);
  console.warn(
    "   Using production preview instead (build + vite preview).\n" +
      "   For hot reload, move or clone the repo to a plain path, e.g. C:\\dev\\MFP_analysis_app\n",
  );
}

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm", ["run", "build"]);
run("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]);
