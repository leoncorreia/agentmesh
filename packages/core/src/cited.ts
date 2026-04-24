import { access, appendFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

export interface CitationRecord {
  url: string;
  note: string;
}

export async function appendCitedRun(params: {
  heading: string;
  summary: string;
  citations: CitationRecord[];
  actions: string[];
}): Promise<void> {
  const filePath = resolve(process.cwd(), 'cited.md');
  try {
    await access(filePath, constants.F_OK);
  } catch {
    await appendFile(
      filePath,
      '# cited.md\n\nAutonomous AgentMesh run log with source citations.\n\n',
      'utf-8',
    );
  }

  const lines: string[] = [];
  lines.push(`## ${params.heading}`);
  lines.push('');
  lines.push(params.summary);
  lines.push('');
  lines.push('### Sources');
  for (const c of params.citations) {
    lines.push(`- ${c.note}: ${c.url}`);
  }
  lines.push('');
  lines.push('### Actions');
  for (const action of params.actions) {
    lines.push(`- ${action}`);
  }
  lines.push('\n');
  await appendFile(filePath, `${lines.join('\n')}\n`, 'utf-8');
}
