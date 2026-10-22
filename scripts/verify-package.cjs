/** Verifies the final Windows portable archive and runs isolated, hidden smoke tests without sending keys. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const output = path.resolve(root, manifest.build.directories.output);
const artifacts = path.join(root, 'artifacts');
const inspection = path.join(artifacts, 'package-inspection');
const filename = manifest.build.portable.artifactName.replace('${version}', manifest.version);
const executable = path.join(output, filename);
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex');
const relative = file => path.relative(root, file).replaceAll('\\', '/');

function command(program, args) {
  return execFileSync(program, args, { cwd: root, windowsHide: true, encoding: 'utf8' });
}

function desktopProcesses() {
  const query = "ConvertTo-Json -InputObject @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and ($_.Name -match 'Elysia|爱莉希雅|electron' -or ($_.Name -eq 'powershell.exe' -and ($_.CommandLine -like '*legacy-hotkeys.ps1 -ParentProcessId*' -or $_.CommandLine -like '*typed-keys.ps1 -ParentProcessId*'))) } | Select-Object ProcessId,Name) -Depth 3";
  return JSON.parse(command('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', query]));
}

function smoke(program, consoleRequired) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(program, ['--smoke-test'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Smoke test exceeded 45 seconds')); }, 45000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', exitCode => {
      clearTimeout(timeout);
      try {
        assert.equal(exitCode, 0, output);
        const line = output.split(/\r?\n/).find(line => line.startsWith('{"smoke":'));
        if (consoleRequired) assert.ok(line, 'The packaged renderer did not report a smoke result');
        const result = line ? JSON.parse(line) : null;
        if (result) assert.equal(result.smoke, 'ok');
        resolve({ exitCode, result, output });
      } catch (error) { reject(error); }
    });
  });
}

(async () => {
  assert.equal(process.platform, 'win32', 'This verifier starts a Windows desktop executable');
  fs.mkdirSync(inspection, { recursive: true });
  // electron-builder installs electron-winstaller, whose full 7-Zip build can
  // read NSIS containers as well as their embedded 7z payloads.
  const sevenZip = require.resolve('electron-winstaller/vendor/7z.exe');
  command(sevenZip, ['e', executable, '$PLUGINSDIR\\app-64.7z', `-o${inspection}`, '-y']);
  command(sevenZip, ['x', path.join(inspection, 'app-64.7z'), 'resources/app.asar', 'resources/app.asar.unpacked/*', `-o${inspection}`, '-y']);
  const archive = path.join(inspection, 'resources/app.asar');
  const expected = [...new Set(manifest.build.files.flatMap(pattern => fs.globSync(pattern, { cwd: root })))]
    .filter(file => fs.statSync(path.join(root, file)).isFile()).map(file => file.replaceAll('\\', '/')).sort();
  const actual = asar.listPackage(archive).map(file => file.replace(/^[/\\]/, '').replaceAll('\\', '/'))
    .filter(file => !asar.statFile(archive, path.normalize(file)).files).sort();
  assert.deepEqual(actual, expected, 'Final EXE contains missing or unexpected files');

  const hashes = {};
  for (const file of expected.filter(file => file !== 'package.json')) {
    const source = fs.readFileSync(path.join(root, file));
    assert.ok(source.equals(asar.extractFile(archive, path.normalize(file))), `Packaged bytes differ: ${file}`);
    hashes[file] = digest(source);
  }
  const packagedManifest = JSON.parse(asar.extractFile(archive, 'package.json'));
  for (const key of ['version', 'license', 'repository']) assert.deepEqual(packagedManifest[key], manifest[key]);
  assert.ok(fs.readFileSync(archive).equals(fs.readFileSync(path.join(output, 'win-unpacked/resources/app.asar'))), 'Portable and directory archives differ');

  const before = desktopProcesses();
  const directory = await smoke(path.join(output, 'win-unpacked', `${manifest.productName}.exe`), true);
  // NSIS ExecWait forwards the child's exit code, but does not forward stdout.
  const portable = await smoke(executable, false);
  const after = desktopProcesses();
  const previousIds = new Set(before.map(process => process.ProcessId));
  const newRemainingProcesses = after.filter(process => !previousIds.has(process.ProcessId));
  assert.deepEqual(newRemainingProcesses, [], 'A smoke process remained after exit');
  assert.ok(before.every(process => after.some(current => current.ProcessId === process.ProcessId)), 'The previous desktop process set changed during verification');
  fs.writeFileSync(path.join(artifacts, 'package-smoke.log'), `Directory (exit ${directory.exitCode}):\n${directory.output}\nPortable (exit ${portable.exitCode}; NSIS does not forward stdout):\n${portable.output}`);

  const exeHash = digest(fs.readFileSync(executable));
  const report = {
    version: manifest.version, electron: manifest.devDependencies.electron,
    executable: relative(executable), bytes: fs.statSync(executable).size, sha256: exeHash,
    runtimeFiles: expected.filter(file => /^(electron|renderer)\//.test(file)),
    assetFiles: expected.filter(file => file.startsWith('assets/')),
    licenseFiles: expected.filter(file => ['LICENSE', 'ASSET-NOTICE.md'].includes(file)),
    exactFileList: true, exactSourceBytes: true, fileHashes: hashes,
    smoke: { directoryExitCode: directory.exitCode, portableExitCode: portable.exitCode, renderer: directory.result.renderer, desktopChecks:directory.result.desktopChecks, security: directory.result.security, portableLogNote: 'The byte-identical directory build supplies detailed mesh-renderer/IPC logs; NSIS forwards the portable smoke child exit code.' },
    processes: { previousCount: before.length, previousInstancesPreserved: true, newRemainingProcesses },
    syntheticGlobalInput: false,
  };
  fs.writeFileSync(path.join(artifacts, 'release-check.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(executable + '.sha256', `${exeHash}  ${filename}\n`);
  console.log(JSON.stringify({ executable: report.executable, bytes: report.bytes, sha256: exeHash, runtimeFiles: report.runtimeFiles.length, pngFiles: report.assetFiles.filter(file => file.endsWith('.png')).length, licenseFiles: report.licenseFiles, smoke: 'passed', report: 'artifacts/release-check.json' }));
})().catch(error => { console.error(error); process.exitCode = 1; });
