import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
export const RELEASE_REPO = "Elixir-Piloting/quill";
export const ASSET_NAME = "Quill_x64-setup.exe";
export const VERSION_FILES = ["package.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"];

export function resolveKind(arg) {
  const kind = (arg || "patch").toLowerCase();
  if (!["major", "minor", "patch"].includes(kind)) throw new Error(`Unknown bump kind: ${kind}`);
  return kind;
}

export function nextVersion(current, kind) {
  if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error(`Invalid release version: ${current}`);
  const [major, minor, patch] = current.split(".").map(Number);
  switch (resolveKind(kind)) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    default: return `${major}.${minor}.${patch + 1}`;
  }
}

export function readVersion(root = ROOT) {
  const pkg = JSON.parse(readFileSync(resolve(root, VERSION_FILES[0]), "utf8")).version;
  const cargo = readFileSync(resolve(root, VERSION_FILES[1]), "utf8").match(/^version = "(\d+\.\d+\.\d+)"/m)?.[1];
  const lock = readFileSync(resolve(root, VERSION_FILES[2]), "utf8").match(/\[\[package\]\]\r?\nname = "quill"\r?\nversion = "(\d+\.\d+\.\d+)"/)?.[1];
  const tauri = JSON.parse(readFileSync(resolve(root, VERSION_FILES[3]), "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/.test(pkg) || [cargo, lock, tauri].some(version => version !== pkg)) {
    throw new Error("Release versions must match in package.json, Cargo.toml, Cargo.lock, and tauri.conf.json.");
  }
  return pkg;
}

export function writeVersion(version, root = ROOT) {
  readVersion(root);
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  for (const file of [VERSION_FILES[0], VERSION_FILES[3]]) {
    const path = resolve(root, file);
    const data = JSON.parse(readFileSync(path, "utf8"));
    data.version = version;
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
  }
  const cargo = resolve(root, VERSION_FILES[1]);
  writeFileSync(cargo, readFileSync(cargo, "utf8").replace(/^version = "\d+\.\d+\.\d+"/m, `version = "${version}"`));
  const lock = resolve(root, VERSION_FILES[2]);
  // Only the application package changes; dependency versions stay pinned.
  writeFileSync(lock, readFileSync(lock, "utf8").replace(/(\[\[package\]\]\r?\nname = "quill"\r?\nversion = ")[^"]+/, (_match, prefix) => `${prefix}${version}`));
}

function command(binary, args, capture = false) {
  const result = spawnSync(binary, args, { cwd: ROOT, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${binary} ${args.join(" ")} failed${capture ? `: ${result.stderr?.trim()}` : ""}`);
  return capture ? result.stdout.trim() : "";
}

async function waitForRelease(sha, tag) {
  let run;
  for (let attempt = 0; attempt < 60; attempt++) {
    const runs = JSON.parse(command("gh", ["run", "list", "--repo", RELEASE_REPO, "--workflow", "release.yml", "--event", "push", "--commit", sha, "--json", "databaseId,headBranch"], true));
    run = runs.find(candidate => candidate.headBranch === tag);
    if (run) break;
    await new Promise(done => setTimeout(done, 2000));
  }
  if (!run) throw new Error(`The tag was pushed, but its workflow hasn't appeared yet. Check https://github.com/${RELEASE_REPO}/actions`);
  console.log(`Waiting for GitHub to build, sign, and publish ${tag}...`);
  command("gh", ["run", "watch", String(run.databaseId), "--repo", RELEASE_REPO, "--exit-status", "--interval", "15"]);
  // Pull the legacy updater manifest's bot commit after publication.
  if (!command("git", ["status", "--porcelain"], true) && command("git", ["rev-parse", "HEAD"], true) === sha) {
    command("git", ["fetch", "origin", "main"]);
    command("git", ["merge", "--ff-only", "origin/main"]);
  }
}

async function main(argv) {
  const kind = resolveKind(argv[2]);
  if (command("git", ["status", "--porcelain"], true)) throw new Error("Commit your changes before releasing.");
  if (command("git", ["branch", "--show-current"], true) !== "main") throw new Error("Run the release command from main.");
  command("gh", ["auth", "status"]);
  command("gh", ["workflow", "view", "release.yml", "--repo", RELEASE_REPO], true);
  command("git", ["fetch", "origin", "main", "--tags"]);
  command("git", ["merge", "--ff-only", "origin/main"]);
  const current = readVersion();
  const next = nextVersion(current, kind);
  const tag = `v${next}`;
  if (command("git", ["tag", "--list", tag], true)) throw new Error(`Tag ${tag} already exists.`);
  const originals = VERSION_FILES.map(file => [file, readFileSync(resolve(ROOT, file))]);
  try {
    writeVersion(next);
    command("git", ["add", "--", ...VERSION_FILES]);
    command("git", ["commit", "-m", `chore: release ${tag}`]);
  } catch (error) {
    for (const [file, contents] of originals) writeFileSync(resolve(ROOT, file), contents);
    command("git", ["restore", "--staged", "--", ...VERSION_FILES]);
    throw error;
  }
  command("git", ["tag", "-a", tag, "-m", `Quill ${tag}`]);
  const sha = command("git", ["rev-parse", "HEAD"], true);
  command("git", ["push", "--atomic", "origin", "HEAD:refs/heads/main", `refs/tags/${tag}`]);
  await waitForRelease(sha, tag);
  console.log(`Published Quill ${tag}.\nhttps://github.com/${RELEASE_REPO}/releases/latest/download/${ASSET_NAME}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv).catch(error => { console.error(error.message); process.exitCode = 1; });
}
