import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };

const source = readFileSync(resolve(process.cwd(), 'src/pages/IoT.tsx'), 'utf8');
ok(source.includes('export function GunshotMic'), 'reuses the existing Audio Threat Detection component');
ok(/navigator\.mediaDevices\.getUserMedia\(\{ audio: /.test(source) && source.includes('onClick={onMicClick}'),'keeps microphone capture behind an explicit user action');
ok(source.includes("fetch('/api/gunshot', { method: 'POST', body: form })"), 'preserves the existing audio-analysis endpoint contract');

if (failures) process.exit(1);
