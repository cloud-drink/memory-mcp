import express from 'express';
import cors from 'cors';
import { db } from './db.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'static')));

// API: Get all memories
app.get('/api/memories', (req, res) => {
  const memories = db.searchAllProjects('', 1000);
  res.json(memories);
});

// API: Get all activities
app.get('/api/activities', (req, res) => {
  const activities = (db as any).db.prepare('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 500').all();
  res.json(activities);
});

// API: Delete memory
app.delete('/api/memories/:id', (req, res) => {
  const { id } = req.params;
  const success = db.deleteMemory(id);
  res.json({ success });
});

// API: Get all raw turns (conversations)
app.get('/api/turns', (req, res) => {
  const turns = (db as any).db.prepare('SELECT * FROM raw_turns ORDER BY timestamp DESC LIMIT 1000').all();
  res.json(turns);
});

// API: Delete individual records
app.delete('/api/turns/:id', (req, res) => {
  const { id } = req.params;
  const success = db.deleteTurn(id);
  res.json({ success });
});

app.delete('/api/activities/:id', (req, res) => {
  const { id } = req.params;
  const success = db.deleteActivity(id);
  res.json({ success });
});

// API: Delete entire projects (category-specific)
app.delete('/api/projects/:category', (req, res) => {
  try {
    const { category } = req.params;
    const { project_id } = req.body;
    
    if (!project_id) {
      return res.status(400).json({ success: false, error: 'project_id is required' });
    }

    let success = false;
    if (category === 'memories') {
      success = db.deleteProjectMemories(project_id);
    } else if (category === 'turns') {
      success = db.deleteProjectTurns(project_id);
    } else if (category === 'activities') {
      success = db.deleteProjectActivities(project_id);
    } else {
      return res.status(400).json({ success: false, error: `Unknown project category: ${category}` });
    }

    res.json({ success });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Project delete failed:', message);
    res.status(500).json({ success: false, error: message });
  }
});

app.listen(PORT, () => {
  console.log(`\nMemory-MCP Viewer is running at: http://localhost:${PORT}`);
  console.log(`Database path: ${path.join(process.cwd(), 'memory.db')}\n`);
});
