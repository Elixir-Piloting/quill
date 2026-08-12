import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const CARGO = resolve(ROOT, "src-tauri/Cargo.toml");
const PKG = resolve(ROOT, "package.json");
const TAURI = resolve(ROOT, "src-tauri/tauri.conf.json");
const RELEASE_REPO = "Elixir-Piloting/quill";
const SECRETS_FILE = resolve(ROOT, ".release-secrets.json");

const KINDS = ["major", "minor", "patch"];

function run(cmd, opts = {}) {
  // Stream the child's stdout/stderr live so the release run is verbose.
  const res = spawnSync(cmd, { cwd: ROOT, stdio: "inherit", shell: true, ...opts });
  if (res.status !== 0) {
    throw new Error(`${cmd}\nfailed (exit ${res.status}).`);
  }
  return "";
}

function runOk(cmd, opts = {}) {
  const res = spawnSync(cmd, { cwd: ROOT, encoding: "utf8", shell: true, ...opts });
  return (res.stdout || "").trim();
}

function readVersion() {
  const cargo = readFileSync(CARGO, "utf8");
  const m = cargo.match(/^version = "(\d+\.\d+\.\d+)"/m);
  if (!m) throw new Error(`cannot parse version from ${CARGO}`);
  return m[1];
}

export function nextVersion(current, kind) {
  const [major, minor, patch] = current.split(".").map(Number);
  switch (kind) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`unknown bump kind: ${kind}`);
  }
}

export function resolveKind(arg) {
  if (!arg) return "patch";
  const kind = arg.toLowerCase();
  if (!KINDS.includes(kind)) {
    throw new Error(`unknown bump kind: ${kind} (expected one of ${KINDS.join(", ")})`);
  }
  return kind;
}

function writeVersion(version) {
  const cargo = readFileSync(CARGO, "utf8");
  writeFileSync(
    CARGO,
    cargo.replace(/^version = "\d+\.\d+\.\d+"/m, `version = "${version}"`),
  );

  const pkg = JSON.parse(readFileSync(PKG, "utf8"));
  pkg.version = version;
  writeFileSync(PKG, `${JSON.stringify(pkg, null, 2)}\n`);

  const tauri = JSON.parse(readFileSync(TAURI, "utf8"));
  tauri.version = version;
  writeFileSync(TAURI, `${JSON.stringify(tauri, null, 2)}\n`);
}

// Read updater signing secrets from env vars, falling back to a gitignored
// local file. `gh` uses its own keyring auth, so no GitHub token is needed here.
function loadSecrets() {
  let file = {};
  if (existsSync(SECRETS_FILE)) {
    file = JSON.parse(readFileSync(SECRETS_FILE, "utf8"));
  }

  const key =
    process.env.TAURI_SIGNING_PRIVATE_KEY ||
    (file.privateKeyPath && existsSync(file.privateKeyPath)
      ? readFileSync(file.privateKeyPath, "utf8")
      : "") ||
    "";
  const password =
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || file.privateKeyPassword || "";

  if (!key) {
    throw new Error(
      "updater signing private key not found. Set TAURI_SIGNING_PRIVATE_KEY (or point privateKeyPath) " +
        `or create ${SECRETS_FILE} with { privateKeyPath, privateKeyPassword }.`,
    );
  }
  if (!password) {
    throw new Error(
      "updater signing password not found. Set TAURI_SIGNING_PRIVATE_KEY_PASSWORD " +
        `or create ${SECRETS_FILE} with privateKeyPassword.`,
    );
  }
  return { key, password };
}

function bundleFiles(version) {
  const dir = resolve(ROOT, "src-tauri/target/release/bundle/nsis");
  if (!existsSync(dir)) {
    throw new Error(`bundle dir not found: ${dir}`);
  }
  const names = readdirSync(dir);
  const exe = names.find((n) => n === `Quill_${version}_x64-setup.exe`);
  const sig = names.find((n) => n === `${exe}.sig`);
  if (!exe) {
    throw new Error(`installer Quill_${version}_x64-setup.exe not found in ${dir}`);
  }
  if (!sig) {
    throw new Error(`signature for ${exe} not found; did signing run?`);
  }
  return { dir, exe, sig };
}

// `gh` uses its own keyring/creds auth (inherited by child processes); a
// GH_TOKEN set in the parent env passes through automatically.
function ghAuth() {
  return "gh";
}

function publishToReleases(version, { dir, exe, sig }) {
  const tag = `v${version}`;
  const exePath = resolve(dir, exe);
  const sigPath = resolve(dir, sig);

  // GitHub rejects release create / contents PUT on a repo with no commits.
  // Bootstrap an initial commit if the release repo is still empty.
  const commits = runOk(`${ghAuth()} api /repos/${RELEASE_REPO}/commits`);
  if (commits.trim() === "[]") {
    runOk(
      `${ghAuth()} api -X PUT /repos/${RELEASE_REPO}/contents/README.md ` +
        `-f message="initial commit: release-repo bootstrap" ` +
        `-f content="${Buffer.from("Quill release artifacts and update manifest\n").toString("base64")}"`,
    );
  }

  // Recreate the release so re-releases overwrite cleanly.
  runOk(`${ghAuth()} release delete ${tag} --repo ${RELEASE_REPO} --yes`);
  run(
    `${ghAuth()} release create ${tag} --repo ${RELEASE_REPO} --title "Quill v${version}" ` +
      `--notes "Quill v${version}"`,
  );
  run(`${ghAuth()} release upload ${tag} --repo ${RELEASE_REPO} --clobber "${exePath}" "${sigPath}"`);

  // Publish update.json via the contents API (creates or overwrites the
  // committed file), so no credential plumbing beyond `gh` is needed.
  const manifest = {
    version,
    notes: `Quill v${version}`,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        url: `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${exe}`,
        signature: readFileSync(sigPath, "utf8").trim(),
      },
    },
  };
  const content = Buffer.from(JSON.stringify(manifest)).toString("base64");
  // Overwriting an existing file requires its current SHA (contents API).
  // Only trust the .sha when the request succeeds: a 404 also prints a JSON
  // error body to stdout, so gate on the exit code rather than the content.
  const existingRes = spawnSync(
    `${ghAuth()} api /repos/${RELEASE_REPO}/contents/update.json -q .sha`,
    { cwd: ROOT, encoding: "utf8", shell: true },
  );
  const existing =
    existingRes.status === 0 ? (existingRes.stdout || "").trim() : "";
  const shaArg = existing ? ` -f sha="${existing}"` : "";
  run(
    `${ghAuth()} api -X PUT /repos/${RELEASE_REPO}/contents/update.json ` +
      `-f message="Update manifest for v${version}" -f content="${content}"${shaArg}`,
  );
}

function main(argv) {
  const kind = resolveKind(argv[2]);

  const dirty = runOk("git status --porcelain");
  if (dirty) {
    throw new Error("Working tree is not clean. Commit or stash before releasing.");
  }

  const current = readVersion();
  const next = nextVersion(current, kind);
  console.log(`Releasing ${current} -> ${next} (${kind}).`);

  const { key, password } = loadSecrets();
  const signEnv = {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  };

  writeVersion(next);
  console.log("Bumped versions. Building installer...");

  const nsisDir = resolve(ROOT, "src-tauri/target/release/bundle/nsis");
  const exeFile = `Quill_${next}_x64-setup.exe`;
  const exePath = resolve(nsisDir, exeFile);
  let bundle;

  try {
    run("pnpm run tauri build", { env: signEnv });

    // `tauri build` does not always emit the updater signature, so stamp it
    // explicitly (same as the old CI did).
    console.log("Signing installer...");
    run(`pnpm run tauri signer sign "${exePath}"`, { env: signEnv });

    bundle = bundleFiles(next);
  } catch (e) {
    // Restore versions so a failed build/sign leaves no dirty tree (which
    // would block a re-attempt).
    writeVersion(current);
    throw e;
  }

  console.log(`Built + signed bundle: ${bundle.exe}`);

  runOk("git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json");
  run(`git commit -m "chore: release v${next}"`);
  run("git push");
  run("git tag v" + next);
  run(`git push origin v${next}`);

  publishToReleases(next, bundle);
  console.log(`Released v${next}. Installer + update.json published to ${RELEASE_REPO}.`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main(process.argv);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}