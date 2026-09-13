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
commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
inputs = ['apps/api', 'packages/shared', 'deploy/ops', 'scripts/prepare-api-release.py',
          'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'tsconfig.json',
          '.npmrc', '.pnpmfile.cjs', 'pnpmfile.cjs']


def require_clean_inputs():
    current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip()
    if current != commit:
        raise SystemExit('HEAD changed during packaging; retry from a stable commit')
    subprocess.run(['git', 'diff', '--exit-code', commit, '--', *inputs], cwd=repo, check=True)
    untracked = subprocess.check_output(
        ['git', 'ls-files', '--others', '--exclude-standard', '--', *inputs], cwd=repo, text=True)
    if untracked.strip():
        raise SystemExit('Commit release inputs before packaging')


require_clean_inputs()
for path in [repo / 'apps/api/dist', repo / 'packages/shared/dist']:
    if path.exists():
        shutil.rmtree(path)
(repo / 'apps/api/tsconfig.build.tsbuildinfo').unlink(missing_ok=True)
subprocess.run(['pnpm', 'build:api'], cwd=repo, check=True)
require_clean_inputs()
out.mkdir(parents=True)
stage = out / 'stage'
stage.mkdir()
with (out / 'source.tar').open('wb') as stream:
    subprocess.run(['git', 'archive', commit, 'apps/api', 'packages/shared', 'deploy/ops',
                    'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'], cwd=repo, stdout=stream, check=True)
with tarfile.open(out / 'source.tar') as archive:
    archive.extractall(stage)
for name in ['apps/api/dist', 'packages/shared/dist']:
    shutil.copytree(repo / name, stage / name)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
meta = {'commit': commit, 'schemaSha256': sha(stage / 'apps/api/prisma/schema.prisma'), 'lockSha256': sha(stage / 'pnpm-lock.yaml'),
        'migrations': {p.parent.name: sha(p) for p in sorted((stage / 'apps/api/prisma/migrations').glob('*/migration.sql'))}}
(stage / 'RELEASE.json').write_text(json.dumps(meta, indent=2) + '\n')
(stage / 'FILES.sha256').write_text(''.join(f'{sha(p)}  {p.relative_to(stage)}\n' for p in sorted(stage.rglob('*')) if p.is_file()))
with tarfile.open(out / 'release.tgz', 'w:gz') as archive:
    for path in sorted(stage.iterdir()):
        archive.add(path, arcname=path.name)
(out / 'release.sha256').write_text(sha(out / 'release.tgz') + '  release.tgz\n')
print(json.dumps({'commit': commit, 'archive': str(out / 'release.tgz'), 'sha256': sha(out / 'release.tgz')}))
