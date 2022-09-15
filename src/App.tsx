import { useState } from 'react';

import { initBackend } from 'absurd-sql/dist/indexeddb-main-thread';

function getId() { return Date.now() }

class SqlClient {
  private worker: Worker;
  private mResolve = new Map<ReturnType<typeof getId>, (data: any) => void>();
  constructor() {
    const worker = this.worker = new Worker(new URL('./main.worker.ts', import.meta.url), { type:'module' });
    // This is only required because Safari doesn't support nested
    // workers. This installs a handler that will proxy creating web
    // workers through the main thread
    initBackend(worker);

    worker.addEventListener('message', e => {
      switch (e.data.type) {
        case 'query': {
          console.log(e.data);
          this.mResolve.get(e.data.id)?.([e.data.error, e.data.results]);
          this.mResolve.delete(e.data.id);
          return;
        }
        case 'closeDb': {
          this.mResolve.get(e.data.id)?.([undefined, true]);
          this.mResolve.delete(e.data.id)
          return;
        }
        case 'dbSize': {
          this.mResolve.get(e.data.id)?.([undefined, e.data.results]);
          this.mResolve.delete(e.data.id)
          return;
        }
        case 'deleteDb': {
          this.mResolve.get(e.data.id)?.([undefined, true]);
          this.mResolve.delete(e.data.id)
          return;
        }
      }

      console.log(e);
      debugger;
    });
  }

  close() {
    const id = getId()
    this.worker.postMessage({ type: 'closeDb', id });
    return new Promise<[Error|undefined]>(resolve => {
      this.mResolve.set(id, resolve);
    });
  }
  deleteDb() {
    const id = getId()
    this.worker.postMessage({ type: 'deleteDb', id });
    return new Promise<[Error|undefined]>(resolve => {
      this.mResolve.set(id, resolve);
    });
  }

  query<T>(query: string, params: unknown[]) {
    const id = getId();
    this.worker.postMessage({ type: 'query', id, query, params });
    return new Promise<[Error|undefined, T[]]>(resolve => {
      this.mResolve.set(id, resolve);
    });
  }

  getSize() {
    const id = getId();
    this.worker.postMessage({ type: 'dbSize', id });
    return new Promise<[Error|undefined, { /** in bytes */ size:number, blockSize:number }[] ]>(resolve => {
      this.mResolve.set(id, resolve);
    });
  }
}

const sqlClient = new SqlClient();

function App() {
  const [ state, setState ] = useState<{err:Error|undefined, results:unknown[]}>({err: undefined, results: []});

  return (
    <div className="App">
      <form onSubmit={async e => {
        e.preventDefault();
        const query = (new FormData(e.currentTarget)).get('q') as string;
        const [err, results] = await sqlClient.query(query, []);
        setState({err, results});
        return false;
      }}>
        <textarea name="q" defaultValue="SELECT * FROM users" className="w-full font-mono" rows={10}/>
        <div className="flex gap-1">
          <button type="submit">run</button>
          <button type="button" onClick={async (e) => {
            e.preventDefault();
            const [err, results] = await sqlClient.getSize();
            setState({err, results});
            return false;
          }}>size</button>
          <button type="button" onClick={async (e) => {
            e.preventDefault();
            const [err] = await sqlClient.deleteDb();
            setState({err, results:[]});
            return false;
          }}>delete</button>
        </div>
      </form>
      <pre>{state.err ? (<>{state.err.name}: {state.err.message}<br/>{state.err.stack}</>) : (JSON.stringify(state.results))}</pre>
    </div>
  )
}

export default App
