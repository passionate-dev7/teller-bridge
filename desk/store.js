// Swap records: one JSON document per swap in SQLite (node:sqlite). Chain state stays the source of truth; this is the desk's memory of intent.
import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS swaps (id TEXT PRIMARY KEY, hashlock TEXT UNIQUE NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, doc TEXT NOT NULL)');
  }
  insert(s) {
    this.db.prepare('INSERT INTO swaps (id, hashlock, state, created, doc) VALUES (?, ?, ?, ?, ?)').run(s.id, s.hashlock, s.state, s.createdAt, JSON.stringify(s));
  }
  save(s) {
    this.db.prepare('UPDATE swaps SET state = ?, doc = ? WHERE id = ?').run(s.state, JSON.stringify(s), s.id);
  }
  get(id) {
    const r = this.db.prepare('SELECT doc FROM swaps WHERE id = ?').get(id);
    return r ? JSON.parse(r.doc) : null;
  }
  byHashlock(h) {
    const r = this.db.prepare('SELECT doc FROM swaps WHERE hashlock = ?').get(h);
    return r ? JSON.parse(r.doc) : null;
  }
  inStates(states) {
    const q = states.map(() => '?').join(',');
    return this.db.prepare('SELECT doc FROM swaps WHERE state IN (' + q + ') ORDER BY created').all(...states).map((r) => JSON.parse(r.doc));
  }
  recent(states, limit) {
    const q = states.map(() => '?').join(',');
    return this.db.prepare('SELECT doc FROM swaps WHERE state IN (' + q + ') ORDER BY created DESC LIMIT ?').all(...states, limit).map((r) => JSON.parse(r.doc));
  }
}
