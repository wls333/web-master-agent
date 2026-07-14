import { nowIso } from "./ids.mjs";

export class LockManager {
  constructor() {
    this.locks = new Map();
  }

  acquire(resource, owner, ttlMs = 5 * 60 * 1000) {
    this.prune();
    const existing = this.locks.get(resource);
    if (existing) {
      return {
        ok: false,
        lock: existing,
        message: `${resource} is locked by ${existing.owner}`
      };
    }
    const lock = {
      resource,
      owner,
      createdAt: nowIso(),
      expiresAt: new Date(Date.now() + ttlMs).toISOString()
    };
    this.locks.set(resource, lock);
    return { ok: true, lock };
  }

  release(resource, owner) {
    const existing = this.locks.get(resource);
    if (existing && existing.owner === owner) {
      this.locks.delete(resource);
      return true;
    }
    return false;
  }

  list() {
    this.prune();
    return Array.from(this.locks.values());
  }

  prune() {
    const now = Date.now();
    for (const [resource, lock] of this.locks.entries()) {
      if (new Date(lock.expiresAt).getTime() <= now) {
        this.locks.delete(resource);
      }
    }
  }
}
