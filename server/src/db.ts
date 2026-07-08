import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppData } from "./types/index.js";
import { seedData } from "./data/seed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "data", "db.json");

function ensureDbFile(): void {
  if (!fs.existsSync(DB_PATH)) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, JSON.stringify(seedData, null, 2));
  }
}

export function readDb(): AppData {
  ensureDbFile();
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw) as AppData;
}

export function writeDb(data: AppData): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

export function resetDb(): AppData {
  fs.writeFileSync(DB_PATH, JSON.stringify(seedData, null, 2));
  return seedData;
}
