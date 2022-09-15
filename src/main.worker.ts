/// <reference lib="webworker" />

import type { SqlJsStatic, Database } from "sql.js"
import initSqlJs from '@jlongster/sql.js';
import { SQLiteFS } from 'absurd-sql';
// import MemoryBackend from 'absurd-sql/dist/memory';
import IndexedDBBackend from 'absurd-sql/dist/indexeddb-backend';

let SQL: SqlJsStatic & { FS: any, register_for_idb: Function };
let db: Database|undefined;
const cacheSize = 5000;
const pageSize = 8192; // default 4096 bytes
const dbPath = 'sql/db.sqlite';


async function init() {
  SQL = (await initSqlJs({ locateFile: file => file })) as any;
  let sqlFS = new SQLiteFS(SQL.FS, new IndexedDBBackend());
  SQL.register_for_idb(sqlFS);

  SQL.FS.mkdir('/sql');
  SQL.FS.mount(sqlFS, {}, '/sql');

  if (typeof SharedArrayBuffer === 'undefined') {
    let stream = SQL.FS.open(dbPath, 'a+');
    await stream.node.contents.readIfFallback();
    SQL.FS.close(stream);
  }
}

function getDatabase(SQL: SqlJsStatic, path: string) {
  // @ts-ignore
  const db = new SQL.Database(path, { filename: true });
  // Should ALWAYS use the journal in memory mode. Doesn't make
  // any sense at all to write the journal
  //
  // It's also important to use the same page size that our storage
  // system uses. This will change in the future so that you don't
  // have to worry about sqlite's page size (requires some
  // optimizations)
  /*
  db.exec(`
    PRAGMA cache_size=-${cacheSize};
    PRAGMA page_size=${pageSize};
    PRAGMA journal_mode=MEMORY;
  `);
  db.exec('VACUUM');
  */
  db.exec(`
    PRAGMA journal_mode=MEMORY;
  `);

  return db;
}

function query() {
  if (db == null) return;
  db.exec('BEGIN TRANSACTION');
  let stmt = db.prepare(
    'INSERT INTO comments (content, url, title) VALUES (?, ?, ?)'
  );
  stmt.run(['1', '2', '3']);
  stmt.run(['4', '5', '6']);
  db.exec('COMMIT');
  // ---

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS comments USING fts3(content, title, url);
  `);
  stmt = db.prepare('SELECT COUNT(*) as count FROM comments');
  stmt.step();
  let row = stmt.getAsObject();
  row.count;
  stmt.free();
}

init();
self.onmessage = function(msg) {
  switch (msg.data.type) {
    case 'openDb': {
      try {
        if (db == null) db = getDatabase(SQL, dbPath);
        self.postMessage({ type: msg.data.type, id: msg.data.id });
      } catch (error) {
        self.postMessage({ type: msg.data.type, id: msg.data.id, error });
      }
      return;
    }
    case 'closeDb': {
      try {
        if (db != null) {
          db.close();
          db = undefined;
        }
        self.postMessage({ type: msg.data.type, id: msg.data.id });
      } catch (error) {
        self.postMessage({ type: msg.data.type, id: msg.data.id, error });
      }
      return;
    }
    case 'deleteDb': {
      try {
        if (db != null) db.close();
        let exists = true;
        try { SQL.FS.stat(dbPath); } catch (e) { exists = false; }
        if (exists) { SQL.FS.unlink(dbPath); }
        db = undefined;
        self.postMessage({ type: msg.data.type, id: msg.data.id });
      } catch (error) {
        self.postMessage({ type: msg.data.type, id: msg.data.id, error });
      }
      return;
    }
    case 'query': {
      try {
        if (db == null) db = getDatabase(SQL, dbPath);
        const stmt = db.prepare(msg.data.query);
        stmt.bind(msg.data.params);
        const results = [];
        while (stmt.step()) results.push(stmt.getAsObject());
        stmt.free();
        self.postMessage({ type: msg.data.type, id: msg.data.id, results });
      } catch (error) {
        self.postMessage({ type: msg.data.type, id: msg.data.id, error });
      }
      return;
    }
    case 'dbSize': {
      try {
        const { node } = SQL.FS.lookupPath(dbPath);
        let file = node.contents;
        self.postMessage({ type: msg.data.type, id: msg.data.id, results: [file.meta] });
        return;
      } catch (error) {
        self.postMessage({ type: msg.data.type, id: msg.data.id, error });
      }
      return;
    }
  }
  console.log(msg);
  debugger;
};


