/**
 * Persistance de l'état d'un monde : fichier JSON écrit de façon atomique
 * (fichier temporaire puis renommage) avec copie de secours de la version précédente.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorldState } from '../../../packages/engine/src/index.ts';

export class JsonStateStore {
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
  }

  load(): WorldState | undefined {
    if (!existsSync(this.path)) return undefined;
    return JSON.parse(readFileSync(this.path, 'utf8')) as WorldState;
  }

  save(state: WorldState): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    if (existsSync(this.path)) copyFileSync(this.path, `${this.path}.bak`);
    renameSync(tmp, this.path);
  }
}
