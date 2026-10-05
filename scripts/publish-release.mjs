import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ASSET_NAME, RELEASE_REPO, ROOT, readVersion } from "./release.mjs";

function command(binary, args, { input, capture = false } = {}) {
  const result = spawnSync(binary, args, { cwd: ROOT, encoding: "utf8", input, stdio: capture || input ? "pipe" : "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${binary} ${args.join(" ")} failed: ${result.stderr?.trim() || result.status}`);
  return result.stdout?.trim() || "";
}

function api(path) {
  const result = spawnSync("gh", ["api", path], { cwd: ROOT, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout);
  if (result.stderr.includes("HTTP 404")) return null;
  throw new Error(result.stderr.trim());
}

export function validateTag(tag, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`) {
    throw new Error(`Tag ${tag} does not match app version ${version}.`);
  }
}

export function compareVersions(left, right) {
  for (const version of [left, right]) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
  }
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

export function createManifest(version, signature, date = new Date()) {
  validateTag(`v${version}`, version);
  if (!signature.trim()) throw new Error("The updater signature is missing.");
  return {
    version,
    notes: `Quill v${version}`,
    pub_date: date.toISOString(),
    platforms: {
      "windows-x86_64": {
        // Pin the binary to this version so a later release cannot change the
        // bytes between an updater check and the signed download.
        url: `https://github.com/${RELEASE_REPO}/releases/download/v${version}/${ASSET_NAME}`,
        signature: signature.trim(),
      },
    },
  };
}

function syncLegacyManifest(manifest) {
  const path = `repos/${RELEASE_REPO}/contents/update.json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = api(`${path}?ref=main`);
    if (existing) {
      const current = JSON.parse(Buffer.from(existing.content, "base64").toString("utf8"));
      if (compareVersions(current.version, manifest.version) > 0) {
        console.log("A newer updater manifest is already published; leaving it in place.");
        return;
      }
      if (JSON.stringify(current) === JSON.stringify(manifest)) return;
    }
    const body = {
      message: `chore: publish updater manifest v${manifest.version} [skip ci]`,
      branch: "main",
      content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`).toString("base64"),
      ...(existing ? { sha: existing.sha } : {}),
    };
    try {
      command("gh", ["api", "--method", "PUT", path, "--input", "-"], { input: JSON.stringify(body), capture: true });
      return;
    } catch (error) {
      if (attempt === 2 || !error.message.includes("409")) throw error;
    }
  }
}

function main() {
  const version = readVersion();
  const tag = process.env.GITHUB_REF_NAME;
  validateTag(tag, version);
  if (process.env.GITHUB_REPOSITORY !== RELEASE_REPO) throw new Error(`Publishing is only configured for ${RELEASE_REPO}.`);
  if (process.argv.includes("--check")) {
    console.log(`Validated ${tag} and all four version files.`);
    return;
  }

  const artifacts = resolve(ROOT, "artifacts/release");
  mkdirSync(artifacts, { recursive: true });
  const existing = api(`repos/${RELEASE_REPO}/releases/tags/${tag}`);
  if (existing && !existing.draft) {
    // A retry after publication must use the original signed artifacts.
    const hosted = resolve(artifacts, "hosted");
    command("gh", ["release", "download", tag, "--repo", RELEASE_REPO, "--pattern", "update.json", "--dir", hosted, "--clobber"]);
    const manifest = JSON.parse(readFileSync(resolve(hosted, "update.json"), "utf8"));
    validateTag(tag, manifest.version);
    syncLegacyManifest(manifest);
    console.log(`${tag} was already published; updater synchronization completed.`);
    return;
  }

  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) throw new Error("TAURI_SIGNING_PRIVATE_KEY is missing.");
  const installer = resolve(ROOT, `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Quill_${version}_x64-setup.exe`);
  if (statSync(installer).size === 0) throw new Error("The installer is empty.");
  const stableInstaller = resolve(artifacts, ASSET_NAME);
  copyFileSync(installer, stableInstaller);
  command(process.execPath, [resolve(ROOT, "node_modules/@tauri-apps/cli/tauri.js"), "signer", "sign", stableInstaller]);
  const signaturePath = `${stableInstaller}.sig`;
  const manifest = createManifest(version, readFileSync(signaturePath, "utf8"));
  const manifestPath = resolve(artifacts, "update.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  if (!existing) command("gh", ["release", "create", tag, "--repo", RELEASE_REPO, "--verify-tag", "--draft", "--title", `Quill ${tag}`, "--generate-notes"]);
  command("gh", ["release", "upload", tag, "--repo", RELEASE_REPO, "--clobber", stableInstaller, signaturePath, manifestPath]);
  const latest = api(`repos/${RELEASE_REPO}/releases/latest`);
  const makeLatest = !latest || !/^v\d+\.\d+\.\d+$/.test(latest.tag_name) || compareVersions(version, latest.tag_name.slice(1)) >= 0;
  command("gh", ["release", "edit", tag, "--repo", RELEASE_REPO, "--draft=false", `--latest=${makeLatest}`]);
  syncLegacyManifest(manifest);
  console.log(`Published ${tag}: https://github.com/${RELEASE_REPO}/releases/latest/download/${ASSET_NAME}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
