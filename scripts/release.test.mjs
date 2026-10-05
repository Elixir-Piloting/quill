import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ASSET_NAME, nextVersion, readVersion, resolveKind, writeVersion } from "./release.mjs";
import { compareVersions, createManifest, validateTag } from "./publish-release.mjs";

test("version bumps and invalid input", () => {
  assert.equal(nextVersion("1.2.9", "patch"), "1.2.10");
  assert.equal(nextVersion("1.2.9", "minor"), "1.3.0");
  assert.equal(nextVersion("1.2.9", "major"), "2.0.0");
  assert.equal(resolveKind(), "patch");
  assert.equal(resolveKind("MINOR"), "minor");
  assert.throws(() => resolveKind("beta"));
  assert.throws(() => nextVersion("not-a-version", "patch"));
});

function fixture(t, newline = "\n") {
  const root = mkdtempSync(resolve(tmpdir(), "quill-release-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, "src-tauri"));
  writeFileSync(resolve(root, "package.json"), JSON.stringify({ version: "1.2.2", dependencies: { react: "^19" } }));
  writeFileSync(resolve(root, "src-tauri/tauri.conf.json"), JSON.stringify({ version: "1.2.2", productName: "Quill" }));
  writeFileSync(resolve(root, "src-tauri/Cargo.toml"), ['[package]', 'name = "quill"', 'version = "1.2.2"', '[dependencies]', 'tauri = "2"'].join(newline));
  writeFileSync(resolve(root, "src-tauri/Cargo.lock"), ['[[package]]', 'name = "other"', 'version = "9.9.9"', '', '[[package]]', 'name = "quill"', 'version = "1.2.2"', 'dependencies = ["other"]', ''].join(newline));
  return root;
}

for (const newline of ["\n", "\r\n"]) {
  test(`all four versions stay synchronized (${JSON.stringify(newline)})`, t => {
    const root = fixture(t, newline);
    assert.equal(readVersion(root), "1.2.2");
    writeVersion("1.3.0", root);
    assert.equal(readVersion(root), "1.3.0");
    const lock = readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8");
    assert.ok(lock.includes(`name = "other"${newline}version = "9.9.9"`));
    assert.equal(JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).dependencies.react, "^19");
  });
}

test("a version mismatch aborts before modifying files", t => {
  const root = fixture(t);
  writeFileSync(resolve(root, "src-tauri/tauri.conf.json"), '{"version":"1.0.0"}');
  const original = readFileSync(resolve(root, "package.json"), "utf8");
  assert.throws(() => writeVersion("1.2.3", root), /must match/);
  assert.equal(readFileSync(resolve(root, "package.json"), "utf8"), original);
});

test("release tags must match the app version", () => {
  assert.doesNotThrow(() => validateTag("v1.2.3", "1.2.3"));
  assert.throws(() => validateTag("v1.2.4", "1.2.3"));
  assert.throws(() => validateTag("v1.2.3-beta", "1.2.3"));
});

test("updater manifests pin signed bytes while keeping the asset filename stable", () => {
  const first = createManifest("1.2.3", " signed-bytes\n", new Date("2026-10-05T00:00:00Z"));
  const second = createManifest("1.2.4", "another-signature");
  const platform = first.platforms["windows-x86_64"];
  assert.equal(platform.signature, "signed-bytes");
  assert.ok(platform.url.endsWith(`/releases/download/v1.2.3/${ASSET_NAME}`));
  assert.ok(second.platforms["windows-x86_64"].url.endsWith(`/${ASSET_NAME}`));
  assert.throws(() => createManifest("1.2.3", "\n"), /signature/);
});

test("numeric ordering prevents an older release retry from becoming latest", () => {
  assert.equal(compareVersions("1.2.10", "1.2.9"), 1);
  assert.equal(compareVersions("1.3.0", "2.0.0"), -1);
  assert.equal(compareVersions("1.2.3", "1.2.3"), 0);
});
