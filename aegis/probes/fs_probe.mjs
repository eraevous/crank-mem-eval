// Original synthetic probe of Node fs primitives (not crank-mem code).
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const t = fs.mkdtempSync(path.join(os.tmpdir(), 'cmprobe-'));
const root = path.join(t, 'project'), outside = path.join(t, 'outside');
fs.mkdirSync(path.join(root, 'docs'), { recursive: true }); fs.mkdirSync(path.join(outside, 'sub'), { recursive: true });
fs.writeFileSync(path.join(outside, 'private.md'), '# SYNTHETIC-OUTSIDE-HEADING\nbody\n');
fs.writeFileSync(path.join(outside, 'sub', 'notes.md'), '# SYNTHETIC-OUTSIDE-SUBDIR\n');
fs.symlinkSync(path.join(outside, 'private.md'), path.join(root, 'docs', 'notes.md'));   // final-component link
fs.symlinkSync(path.join(outside, 'sub'), path.join(root, 'linked'), 'dir');             // ancestor link
const rel = (p) => { const r = path.relative(root, p); return (!r || r.startsWith('..') || path.isAbsolute(r)) ? null : r; };
const out = {};
out.lexical_relpath_final_link = rel(path.join(root, 'docs/notes.md'));
out.lexical_relpath_ancestor_link = rel(path.join(root, 'linked/notes.md'));
out.statSync_follows_final_link = fs.statSync(path.join(root, 'docs/notes.md')).isFile();
out.readFileSync_reads_outside = fs.readFileSync(path.join(root, 'docs/notes.md'), 'utf8').split('\n')[0];
out.lstat_final_link_isFile = fs.lstatSync(path.join(root, 'docs/notes.md')).isFile();
out.lstat_through_ancestor_link_isFile = fs.lstatSync(path.join(root, 'linked/notes.md')).isFile();
const d = fs.readdirSync(root, { withFileTypes: true }).find(x => x.name === 'linked');
out.dirent_symlink_isDirectory = d.isDirectory(); out.dirent_symlink_isFile = d.isFile();
const real = fs.realpathSync(path.join(root, 'linked/notes.md'));
out.realpath_containment_rejects = !real.startsWith(fs.realpathSync(root) + path.sep);
console.log(JSON.stringify(out, null, 1)); fs.rmSync(t, { recursive: true });
