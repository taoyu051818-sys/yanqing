// Build and upload exactly one committed remote package. Uploading is not
// equivalent to selecting the experience version or passing device acceptance.
import { createHash } from 'node:crypto'
import { closeSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { git, repository, releaseInputs } from '../apps/miniapp/scripts/release-metadata.mjs'
import { auditWechatPackage } from '../apps/miniapp/scripts/check-wechat-package.mjs'

const productionApi = 'https://api.yutechhn.cn/api/v1'
const appId = 'wx25610460bc96894b'
const project = path.join(repository, 'apps/miniapp/dist/build/mp-weixin')
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
export function validateRelease(build, projectConfig, { commit, version }) {
  if (build.dirty || build.commit !== commit || build.version !== version) throw new Error('构建版本与干净源码不一致，请重新准备发布包')
  if (build.dataMode !== 'remote' || build.apiBase !== productionApi) throw new Error('必须使用正式接口的 remote 构建')
  if (projectConfig.appid !== appId || projectConfig.compileType !== 'miniprogram') throw new Error('AppID 或项目类型不正确')
}
export function packageDigest(directory) {
  const digest = createHash('sha256')
  const files = []
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      if (entry.name === 'project.private.config.json') continue
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile()) files.push(file)
      else throw new Error('发布包不能包含符号链接')
    }
  }
  walk(directory)
  for (const file of files) {
    digest.update(path.relative(directory, file)).update('\0')
    digest.update(createHash('sha256').update(readFileSync(file)).digest()).update('\0')
  }
  return digest.digest('hex')
}
function cleanCommit() {
  if (git('status', '--porcelain', '--', ...releaseInputs)) throw new Error('请先提交本次发布相关源码；不会上传未提交修改')
  return git('rev-parse', 'HEAD')
}
function nativeStyles(packageDirectory) {
  const compiler = process.env.WECHAT_WXSS_COMPILER || '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec/wcsc'
  if (!existsSync(compiler)) throw new Error('需要微信开发者工具的 WXSS 编译器；可用 WECHAT_WXSS_COMPILER 指定路径')
  let count = 0
  function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.name.endsWith('.wxss')) {
        execFileSync(compiler, [path.relative(packageDirectory, file), '-o', '/dev/null'], { cwd: packageDirectory, stdio: ['ignore', 'ignore', 'pipe'] })
        count++
      }
    }
  }
  walk(packageDirectory)
  return count
}

async function main() {
  const mode = process.argv[2]
  if (!['prepare', 'upload'].includes(mode)) throw new Error('Usage: node scripts/release-miniapp.mjs prepare|upload')
  const output = path.join(repository, 'output')
  mkdirSync(output, { recursive: true })
  const lockFile = path.join(output, '.miniapp-release.lock')
  let lock
  try {
    lock = openSync(lockFile, 'wx')
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('另一发布任务持有 output/.miniapp-release.lock；确认该任务退出后才可清理遗留锁')
    throw error
  }
  try {
    writeFileSync(lock, JSON.stringify({ pid: process.pid, mode, startedAt: new Date().toISOString() }))
    await release(mode)
  } finally {
    closeSync(lock)
    unlinkSync(lockFile)
  }
}

async function release(mode) {
  const commit = cleanCommit()
  const version = readJson(path.join(repository, 'apps/miniapp/package.json')).version
  const directory = path.join(repository, 'output/releases', `${version}-${commit.slice(0, 12)}`)
  const receiptFile = path.join(directory, 'miniapp-release.json')
  let packageDirectory
  let receipt
  if (mode === 'prepare') {
    execFileSync('pnpm', ['build:miniapp'], { cwd: repository, stdio: 'inherit', env: {
      ...process.env, VITE_DATA_MODE: 'remote', VITE_API_BASE_URL: productionApi, VITE_ENABLE_REMOTE_DEV_LOGIN: 'false',
      UNI_OUTPUT_DIR: project,
    } })
    // Independent builds may replace dist. Copy to a unique snapshot and verify
    // both sides so the later network wait/CLI cannot upload a different build.
    const sourceDigest = packageDigest(project)
    mkdirSync(directory, { recursive: true })
    packageDirectory = mkdtempSync(path.join(directory, 'package-'))
    cpSync(project, packageDirectory, { recursive: true })
    if (packageDigest(packageDirectory) !== sourceDigest || packageDigest(project) !== sourceDigest) {
      throw new Error('复制发布包期间构建产物发生变化，请重新 prepare')
    }
  } else {
    receipt = readJson(receiptFile)
    if (!/^package-[A-Za-z0-9]+$/.test(receipt.packageFolder || '')) throw new Error('发布记录缺少独立快照，请重新 prepare')
    packageDirectory = path.join(directory, receipt.packageFolder)
    if (!lstatSync(packageDirectory).isDirectory()) throw new Error('发布快照必须是独立目录')
  }
  if (cleanCommit() !== commit) throw new Error('构建期间源码提交发生变化')
  const build = readJson(path.join(packageDirectory, 'release-info.json'))
  validateRelease(build, readJson(path.join(packageDirectory, 'project.config.json')), { commit, version })
  const audit = auditWechatPackage(packageDirectory, { remote: true })
  if (!audit.ok) throw new Error(audit.problems.join('\n'))
  const digest = packageDigest(packageDirectory)
  if (mode === 'prepare') {
    const wxssFiles = nativeStyles(packageDirectory)
    if (cleanCommit() !== commit || packageDigest(packageDirectory) !== digest) throw new Error('检查期间发布输入发生变化，请重新 prepare')
    writeFileSync(receiptFile, JSON.stringify({ ...build, appId, digest, wxssFiles, packageFolder: path.basename(packageDirectory), preparedAt: new Date().toISOString(),
      upload: 'pending', experienceVersion: 'unverified', deviceAcceptance: 'pending',
      totalBytes: audit.totalBytes, mainBytes: audit.mainBytes,
    }, null, 2) + '\n')
    console.log('Prepared', receiptFile)
    return
  }
  if (receipt.digest !== digest || receipt.commit !== commit || !receipt.wxssFiles) throw new Error('发布包已改变或未完成原生样式检查，请重新 prepare')
  const response = await fetch(productionApi + '/health/ready', { signal: AbortSignal.timeout(15000) })
  const health = await response.json()
  if (!response.ok || health.code !== 0 || health.data?.status !== 'ok' || health.data?.checks?.database !== 'ok' || health.data?.revision !== commit) {
    throw new Error('服务器尚未就绪到本次提交，请先完成服务器部署')
  }
  if (cleanCommit() !== commit || packageDigest(packageDirectory) !== digest) throw new Error('等待服务就绪期间发布输入发生变化，请重新 prepare')
  const cli = process.env.WECHAT_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
  execFileSync(cli, ['upload', '--project', packageDirectory, '--version', version, '--desc', `岗位操作减负与版本核对；${commit.slice(0, 7)}`], { cwd: repository, stdio: 'inherit' })
  writeFileSync(receiptFile, JSON.stringify({ ...receipt, upload: 'succeeded', uploadedAt: new Date().toISOString(), serverRevision: health.data.revision,
    // This CLI action cannot verify the WeChat console's experience-version flag.
    experienceVersion: 'unverified', deviceAcceptance: 'pending',
  }, null, 2) + '\n')
  console.log('Uploaded; experience version and phone acceptance remain unverified:', receiptFile)
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
