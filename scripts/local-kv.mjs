import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Development-only KV adapter. Production continues to use EdgeOne KV. */
export function createLocalKv(directory) {
  const filePath = key => {
    if (!/^[a-zA-Z0-9_-]{1,512}$/.test(key)) throw new Error('Invalid local KV key');
    return join(directory, `${key}.json`);
  };
  return {
    async put(key, value) {
      const destination = filePath(key);
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `${randomUUID()}.tmp`);
      await writeFile(temporary, value, { mode: 0o600 });
      await rename(temporary, destination);
    },
    async get(key, options) {
      try {
        const value = await readFile(filePath(key), 'utf8');
        return options?.type === 'json' ? JSON.parse(value) : value;
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async list({ prefix = '', limit = 24, cursor } = {}) {
      await mkdir(directory, { recursive: true });
      const after = cursor ? Buffer.from(cursor, 'hex').toString('utf8') : '';
      const keys = (await readdir(directory)).filter(name => name.endsWith('.json'))
        .map(name => name.slice(0, -5)).filter(key => key.startsWith(prefix) && key > after).sort();
      const page = keys.slice(0, limit);
      const complete = keys.length <= limit;
      return {
        keys: page.map(key => ({ key })), complete,
        cursor: complete ? undefined : Buffer.from(page.at(-1)).toString('hex')
      };
    }
  };
}
