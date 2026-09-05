#!/usr/bin/env node
/* Copyright (c) 2026, Salesforce, Inc. Apache-2.0 */
/* Pre-publish guard for agentscript issue 71; run after scope rewrite. */
/* Complementary to verify-published-packages.mjs (PR 72). */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const INTERNAL_SCOPE = "@agentscript/";
const PUBLISH_SCOPE = "@sf-agentscript/";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function hashDistTree(pkgPath) {
  const dist = join(pkgPath, "dist");
  if (!existsSync(dist) || !statSync(dist).isDirectory()) return null;
  const files = walk(dist).filter((f) => !f.endsWith(".map")).sort();
  if (files.length === 0) return null;
  const h = createHash("sha256");
  for (const file of files) {
    h.update(relative(dist, file).replaceAll(String.fromCharCode(92), "/"));
    h.update(Buffer.from([0]));
    h.update(readFileSync(file));
    h.update(Buffer.from([0]));
  }
  return h.digest("hex");
}

function publishName(name) {
  if (name.startsWith(PUBLISH_SCOPE)) return name;
  if (name.startsWith(INTERNAL_SCOPE)) return name.replace(INTERNAL_SCOPE, PUBLISH_SCOPE);
  return name;
}

function npmMeta(name, version) {
  const url = "https://registry.npmjs.org/" + name.replace("/", "%2F") + "/" + version;
  try {
    const raw = execFileSync("curl", ["-sS", "-f", "-L", url], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hashRemoteDist(tarballUrl) {
  const dir = mkdtempSync(join(tmpdir(), "as-reg-"));
  const tgz = join(dir, "pkg.tgz");
  try {
    execFileSync("curl", ["-sS", "-f", "-L", "-o", tgz, tarballUrl], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync("tar", ["-xzf", tgz, "-C", dir], { stdio: "pipe" });
    return hashDistTree(join(dir, "package"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readPkgJson(pkgPath) {
  return JSON.parse(readFileSync(join(pkgPath, "package.json"), "utf8"));
}

function workspaceScopedDepNames(pkgJson) {
  const deps = { ...(pkgJson.dependencies || {}), ...(pkgJson.optionalDependencies || {}) };
  return Object.keys(deps).filter((n) => n.startsWith(INTERNAL_SCOPE) || n.startsWith(PUBLISH_SCOPE));
}
console.log("assert registry content");
const listOut = execFileSync("pnpm", ["-r", "list", "--json", "--depth", "-1"], { cwd: ROOT, encoding: "utf8" });
const workspacePkgs = JSON.parse(listOut);
const byPublishName = new Map();
for (const pkg of workspacePkgs) {
  const json = readPkgJson(pkg.path);
  if (json.private) continue;
  byPublishName.set(publishName(json.name), { path: pkg.path, version: json.version, json });
}

const stale = [];
const willPublish = [];

for (const [name, info] of byPublishName) {
  const localHash = hashDistTree(info.path);
  if (!localHash) {
    console.log("  skip " + name + "@" + info.version + " (no dist)");
    continue;
  }
  const meta = npmMeta(name, info.version);
  if (!meta) {
    willPublish.push(name);
    console.log("  new   " + name + "@" + info.version);
    continue;
  }
  const tarball = meta.dist && meta.dist.tarball;
  if (!tarball) {
    console.log("  skip " + name + "@" + info.version + " (no tarball)");
    continue;
  }
  const remoteHash = hashRemoteDist(tarball);
  if (!remoteHash) {
    console.log("  skip " + name + "@" + info.version + " (remote no dist)");
    continue;
  }
  if (localHash !== remoteHash) {
    stale.push({ name, version: info.version, localHash, remoteHash });
    console.log("  STALE " + name + "@" + info.version);
  } else {
    console.log("  ok    " + name + "@" + info.version);
  }
}

if (stale.length === 0) {
  console.log("No stale version reuse detected.");
  process.exit(0);
}

const staleNames = new Set(stale.map((s) => s.name));
const blockers = [];
for (const name of willPublish) {
  const info = byPublishName.get(name);
  if (!info) continue;
  for (const depNameRaw of workspaceScopedDepNames(info.json)) {
    const depName = publishName(depNameRaw);
    if (!staleNames.has(depName)) continue;
    const depInfo = byPublishName.get(depName);
    blockers.push({
      pkg: name + "@" + info.version,
      dep: depName + "@" + (depInfo ? depInfo.version : "?"),
    });
  }
}

if (blockers.length === 0) {
  console.log("warn: reused version with different dist; no publishing dependent");
  for (const s of stale) console.log("  - " + s.name + "@" + s.version);
  process.exit(0);
}
console.error("guard failed: dependency pin targets registry content that differs from local dist");
console.error("see salesforce agentscript issue 71");
console.error("bad pins:");
for (const b of blockers) console.error("  - " + b.pkg + " -> STALE " + b.dep);
console.error("bump stale package versions so workspace protocol stamps a fresh version");
for (const s of stale) console.error("  stale: " + s.name + "@" + s.version);
process.exit(1);
