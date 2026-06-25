import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const failures = [];

const [packageJson, tauriConfig, cargoToml] = await Promise.all([
  readJson("package.json"),
  readJson("src-tauri/tauri.conf.json"),
  readText("src-tauri/Cargo.toml")
]);

const version = packageJson.version;
const cargoVersion = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

expect(typeof version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version), "package.json must contain a valid release version.");
expect(tauriConfig.version === version, "package.json and tauri.conf.json versions must match.");
expect(cargoVersion === version, "package.json and Cargo.toml versions must match.");
expect(tauriConfig.bundle?.createUpdaterArtifacts === true, "Updater artifacts must be enabled for a release.");
expect(typeof tauriConfig.plugins?.updater?.pubkey === "string" && tauriConfig.plugins.updater.pubkey.length > 40, "Updater public key is missing.");
expect(Array.isArray(tauriConfig.plugins?.updater?.endpoints) && tauriConfig.plugins.updater.endpoints.length > 0, "Updater endpoint is missing.");

const tagIndex = process.argv.indexOf("--tag");
if (tagIndex >= 0) {
  const tag = process.argv[tagIndex + 1];
  expect(tag === `v${version}`, `Release tag must be v${version}; received ${tag ?? "nothing"}.`);
}

if (args.has("--require-updater-signing") || args.has("--require-signing")) {
  for (const name of [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
  ]) {
    expect(Boolean(process.env[name]), `${name} is required for signed updater metadata.`);
  }
}

if (args.has("--require-os-signing") || args.has("--require-signing")) {
  for (const name of [
    "APPLE_CERTIFICATE",
    "APPLE_CERTIFICATE_PASSWORD",
    "APPLE_ID",
    "APPLE_PASSWORD",
    "APPLE_TEAM_ID",
    "KEYCHAIN_PASSWORD",
    "WINDOWS_CERTIFICATE",
    "WINDOWS_CERTIFICATE_PASSWORD",
    "WINDOWS_CERTIFICATE_THUMBPRINT"
  ]) {
    expect(Boolean(process.env[name]), `${name} is required for warning-free OS-signed distribution.`);
  }
}

if (failures.length > 0) {
  console.error("Release preflight failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Release preflight passed for v${version}.`);

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readText(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message);
  }
}
