#!/usr/bin/env python3
"""Build a clean, committed API release. No credentials or node_modules included."""
import hashlib
import json
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

repo = Path(__file__).resolve().parents[1]
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 scripts/prepare-api-release.py /absolute/new/output-directory')
out = Path(sys.argv[1])
if not out.is_absolute() or out.exists():
    raise SystemExit('Output must be a new absolute directory')
subprocess.run(['git', 'diff', '--exit-code', 'HEAD', '--', 'apps/api', 'packages/shared', 'deploy/ops', 'scripts/prepare-api-release.py', 'pnpm-lock.yaml'], cwd=repo, check=True)
untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '--', 'apps/api', 'packages/shared', 'deploy/ops'], cwd=repo, text=True)
if untracked.strip():
    raise SystemExit('Commit release inputs before packaging')
for path in [repo / 'apps/api/dist', repo / 'packages/shared/dist']:
    if path.exists():
        shutil.rmtree(path)
(repo / 'apps/api/tsconfig.build.tsbuildinfo').unlink(missing_ok=True)
subprocess.run(['pnpm', 'build:api'], cwd=repo, check=True)
out.mkdir(parents=True)
stage = out / 'stage'
stage.mkdir()
with (out / 'source.tar').open('wb') as stream:
    subprocess.run(['git', 'archive', 'HEAD', 'apps/api', 'packages/shared', 'deploy/ops', 'pnpm-lock.yaml'], cwd=repo, stdout=stream, check=True)
with tarfile.open(out / 'source.tar') as archive:
    archive.extractall(stage)
for name in ['apps/api/dist', 'packages/shared/dist']:
    shutil.copytree(repo / name, stage / name)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
meta = {'commit': commit, 'schemaSha256': sha(stage / 'apps/api/prisma/schema.prisma'), 'lockSha256': sha(stage / 'pnpm-lock.yaml'),
        'migrations': {p.parent.name: sha(p) for p in sorted((stage / 'apps/api/prisma/migrations').glob('*/migration.sql'))}}
(stage / 'RELEASE.json').write_text(json.dumps(meta, indent=2) + '\n')
(stage / 'FILES.sha256').write_text(''.join(f'{sha(p)}  {p.relative_to(stage)}\n' for p in sorted(stage.rglob('*')) if p.is_file()))
with tarfile.open(out / 'release.tgz', 'w:gz') as archive:
    for path in sorted(stage.iterdir()):
        archive.add(path, arcname=path.name)
(out / 'release.sha256').write_text(sha(out / 'release.tgz') + '  release.tgz\n')
print(json.dumps({'commit': commit, 'archive': str(out / 'release.tgz'), 'sha256': sha(out / 'release.tgz')}))
