import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Memory {
  id: string;
  project_id: string;
  content: string;
  type: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  project_id: string;
  session_id?: string;
  tool_name: string;
  arguments: string;
  files_accessed?: string;
  result_summary: string;
  is_success: number;
  timestamp: string;
}

class MemoryDB {
  private db: Database.Database;

  constructor() {
    const dbPath = path.join(__dirname, '..', 'memory.db');
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    // Enable FTS5
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories_content (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        content TEXT,
        type TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Use a simpler FTS5 table that stores the ID explicitly for joining
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        memory_id UNINDEXED
      );

      CREATE TABLE IF NOT EXISTS raw_turns (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        role TEXT,
        content TEXT,
        is_finalized INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        session_id TEXT,
        tool_name TEXT,
        arguments TEXT,
        files_accessed TEXT,
        result_summary TEXT,
        is_success INTEGER,
        is_finalized INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrate older databases that lack the column
    for (const migration of [
      'ALTER TABLE activity_logs ADD COLUMN is_finalized INTEGER DEFAULT 0',
      'ALTER TABLE raw_turns ADD COLUMN is_finalized INTEGER DEFAULT 0',
    ]) {
      try { this.db.exec(migration); } catch { /* column already exists */ }
    }
  }

  // Memory Methods
  addMemory(project_id: string, content: string, type: string = 'manual', session_id?: string): string {
    const id = uuidv4();
    const insert = this.db.prepare(
      'INSERT INTO memories_content (id, project_id, content, type) VALUES (?, ?, ?, ?)'
    );
    insert.run(id, project_id, content, type);

    // Update FTS index with the explicit memory_id
    this.db.prepare('INSERT INTO memories_fts (content, memory_id) VALUES (?, ?)').run(content, id);
    
    // If a session ID is provided, mark it as finalized
    if (session_id) {
      this.markSessionAsFinalized(session_id);
    }

    return id;
  }

  private sanitizeFts5Query(query: string): string {
    // Replace FTS5 special characters with spaces to prevent syntax errors.
    // Characters: - " * ( ) and leading/trailing whitespace can confuse the parser.
    return query.replace(/["*()]/g, ' ').replace(/-/g, ' ');
  }

  searchMemory(project_id: string, query: string, limit: number = 10): any[] {
    const search = this.db.prepare(`
      SELECT m.* FROM memories_content m
      JOIN memories_fts f ON m.id = f.memory_id
      WHERE (m.project_id = ? OR m.project_id = 'global') AND memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return search.all(project_id, this.sanitizeFts5Query(query), limit);
  }

  searchAllProjects(query: string, limit: number = 10): any[] {
    if (!query.trim()) {
      return this.db.prepare('SELECT * FROM memories_content ORDER BY created_at DESC LIMIT ?').all(limit);
    }
    const search = this.db.prepare(`
      SELECT m.* FROM memories_content m
      JOIN memories_fts f ON m.id = f.memory_id
      WHERE memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return search.all(this.sanitizeFts5Query(query), limit);
  }

  deleteMemory(id: string): boolean {
    const delContent = this.db.prepare('DELETE FROM memories_content WHERE id = ?');
    const result = delContent.run(id);
    
    const delFts = this.db.prepare('DELETE FROM memories_fts WHERE memory_id = ?');
    delFts.run(id);

    return result.changes > 0;
  }

  // Turn Methods
  addTurn(project_id: string, session_id: string, role: string, content: string): string {
    const id = uuidv4();
    const insert = this.db.prepare(`
      INSERT INTO raw_turns (id, project_id, session_id, role, content)
      VALUES (?, ?, ?, ?, ?)
    `);
    insert.run(id, project_id, session_id, role, content);
    return id;
  }

  getUnfinalizedTurns(session_id: string): any[] {
    const query = this.db.prepare(`
      SELECT * FROM raw_turns 
      WHERE session_id = ? AND is_finalized = 0 
      ORDER BY timestamp ASC
    `);
    return query.all(session_id);
  }

  // Activity Methods
  recordActivity(log: Omit<ActivityLog, 'id' | 'timestamp'>): string {
    const id = uuidv4();
    const insert = this.db.prepare(`
      INSERT INTO activity_logs (id, project_id, session_id, tool_name, arguments, files_accessed, result_summary, is_success)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      id,
      log.project_id,
      log.session_id || null,
      log.tool_name,
      log.arguments,
      log.files_accessed || null,
      log.result_summary,
      log.is_success
    );
    return id;
  }

  getUnfinalizedActivities(session_id: string): any[] {
    const query = this.db.prepare(`
      SELECT * FROM activity_logs 
      WHERE session_id = ? AND is_finalized = 0 
      ORDER BY timestamp ASC
    `);
    return query.all(session_id);
  }

  markSessionAsFinalized(session_id: string) {
    this.db.prepare('UPDATE raw_turns SET is_finalized = 1 WHERE session_id = ?').run(session_id);
    this.db.prepare('UPDATE activity_logs SET is_finalized = 1 WHERE session_id = ?').run(session_id);
  }

  getUnfinalizedSessions(project_id: string): string[] {
    const query = this.db.prepare(`
      SELECT DISTINCT session_id FROM raw_turns 
      WHERE project_id = ? AND is_finalized = 0
    `);
    const results = query.all(project_id) as { session_id: string }[];
    return results.map(r => r.session_id);
  }

  getAllProjectIds(): string[] {
    const rows = this.db.prepare('SELECT DISTINCT project_id FROM raw_turns').all() as { project_id: string }[];
    return rows.map(r => r.project_id);
  }

  queryActivity(project_id: string, limit: number = 20): any[] {
    const query = this.db.prepare(`
      SELECT * FROM activity_logs 
      WHERE project_id = ? 
      ORDER BY timestamp DESC 
      LIMIT ?
    `);
    return query.all(project_id, limit);
  }

  deleteTurn(id: string): boolean {
    const result = this.db.prepare('DELETE FROM raw_turns WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteActivity(id: string): boolean {
    const result = this.db.prepare('DELETE FROM activity_logs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteProjectMemories(project_id: string): boolean {
    const ids = (this.db.prepare('SELECT id FROM memories_content WHERE project_id = ?').all(project_id) as {id: string}[]).map(r => r.id);
    if (ids.length === 0) return false;

    this.db.prepare('DELETE FROM memories_content WHERE project_id = ?').run(project_id);
    
    // Also clean up FTS
    const deleteFts = this.db.prepare('DELETE FROM memories_fts WHERE memory_id = ?');
    for (const id of ids) {
      deleteFts.run(id);
    }
    return true;
  }

  deleteProjectTurns(project_id: string): boolean {
    const result = this.db.prepare('DELETE FROM raw_turns WHERE project_id = ?').run(project_id);
    return result.changes > 0;
  }

  deleteProjectActivities(project_id: string): boolean {
    const result = this.db.prepare('DELETE FROM activity_logs WHERE project_id = ?').run(project_id);
    return result.changes > 0;
  }
}

export const db = new MemoryDB();
