import { execFileSync } from 'node:child_process';
import path from 'node:path';
// Read the index, not unrelated local drafts. In CI it is the checked-out commit.
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const tracked=new Set(files);
const errors=[];
for(const file of files.filter(name=>name.endsWith('.md'))) {
  const content=execFileSync('git',['show',`:${file}`],{encoding:'utf8'});
  for(const match of content.matchAll(/\]\(([^)]+)\)/g)) {
    const target=match[1].trim().replace(/^<|>$/g,'').split('#')[0];
    // Historical machine paths and external URLs are outside this local-link check.
    if(!target || target.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(target)));
    if(!tracked.has(resolved) && !files.some(name=>name.startsWith(resolved.replace(/\/$/,'')+'/')))
      errors.push(`${file}: ${target} is not tracked; commit the document or label it as local-only evidence`);
  }
}
if(errors.length){ console.error(errors.join('\n')); process.exitCode=1; }
else console.log(`PASS: relative links in ${files.filter(file=>file.endsWith('.md')).length} indexed Markdown files resolve to tracked files.`);
