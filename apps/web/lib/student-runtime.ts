import { repository } from './runtime.ts';
import { createStudentRepository, type StudentRepository } from './student-repository.ts';
import { getRuntimeConfig } from './runtime-config.ts';
const local = globalThis as typeof globalThis & { comgroundStudents?: StudentRepository };
export function students(): StudentRepository {
  // Initialize catalogue migrations and one-time synthetic seed before private tables.
  const supply = repository();
  const config = getRuntimeConfig();
  return local.comgroundStudents ??= createStudentRepository(config.dbPath, supply, { allowDemo: config.mode === 'demo', seedExamples: config.mode !== 'production' });
}
