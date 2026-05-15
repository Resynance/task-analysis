import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const USERS_JSON_REL = ["users", "users.json"] as const;

type UsersFileShape = {
  members?: Array<{ id?: unknown; full_name?: unknown; email?: unknown }>;
};

let cached: { mtimeMs: number; map: Map<string, string> } | null = null;
let cachedProfiles: { mtimeMs: number; profiles: UserLookupProfile[] } | null =
  null;

export type UserLookupProfile = {
  id: string;
  fullName: string;
  email: string | null;
};

function parseUsersFile(content: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const profile of parseUsersFileProfiles(content)) {
    map.set(profile.id.toLowerCase(), profile.fullName);
  }
  return map;
}

function parseUsersFileProfiles(content: string): UserLookupProfile[] {
  const raw = JSON.parse(content) as UsersFileShape;
  const profiles: UserLookupProfile[] = [];
  for (const m of raw.members ?? []) {
    if (typeof m.id !== "string" || typeof m.full_name !== "string") continue;
    const id = m.id.trim();
    const fullName = m.full_name.trim();
    const email = typeof m.email === "string" ? m.email.trim() : "";
    if (!id || !fullName) continue;
    profiles.push({
      id,
      fullName,
      email: email || null,
    });
  }
  return profiles;
}

/**
 * Load `users/users.json` (member id → display name). Cached by file mtime so edits
 * apply without restarting the server.
 */
export function loadUserDisplayNames(): Map<string, string> {
  const filePath = path.join(process.cwd(), ...USERS_JSON_REL);
  if (!existsSync(filePath)) {
    cached = null;
    return new Map();
  }
  const st = statSync(filePath);
  if (cached && cached.mtimeMs === st.mtimeMs) {
    return cached.map;
  }
  try {
    const content = readFileSync(filePath, "utf8");
    const map = parseUsersFile(content);
    cached = { mtimeMs: st.mtimeMs, map };
    return map;
  } catch {
    cached = null;
    return new Map();
  }
}

/**
 * Load `users/users.json` as full local identity records. Used by disk-backed reports that need to
 * map emails to author ids from prompt metadata.
 */
export function loadUserLookupProfiles(): UserLookupProfile[] {
  const filePath = path.join(process.cwd(), ...USERS_JSON_REL);
  if (!existsSync(filePath)) {
    cachedProfiles = null;
    return [];
  }
  const st = statSync(filePath);
  if (cachedProfiles && cachedProfiles.mtimeMs === st.mtimeMs) {
    return cachedProfiles.profiles;
  }
  try {
    const content = readFileSync(filePath, "utf8");
    const profiles = parseUsersFileProfiles(content);
    cachedProfiles = { mtimeMs: st.mtimeMs, profiles };
    return profiles;
  } catch {
    cachedProfiles = null;
    return [];
  }
}
