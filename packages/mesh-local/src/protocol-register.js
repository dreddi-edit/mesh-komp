'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

/**
 * Registers the mesh:// URL protocol handler for the current OS.
 * macOS: writes a minimal .app bundle to ~/Applications/
 * Linux: writes a .desktop file and calls xdg-mime
 * Windows: writes a registry entry via reg.exe
 *
 * All execFileSync calls use hardcoded binary paths and pre-validated arguments.
 * No user input is passed to shell commands.
 *
 * @returns {Promise<void>}
 */
async function registerProtocol() {
  const platform = os.platform();
  if (platform === 'darwin') {
    registerMacOS();
  } else if (platform === 'linux') {
    registerLinux();
  } else if (platform === 'win32') {
    registerWindows();
  }
  // Other platforms: silently skip
}

function registerMacOS() {
  const appDir = path.join(os.homedir(), 'Applications', 'MeshLocalAgent.app');
  const contentsDir = path.join(appDir, 'Contents');
  const macOSDir = path.join(contentsDir, 'MacOS');

  fs.mkdirSync(macOSDir, { recursive: true });

  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>mesh-local-handler</string>
  <key>CFBundleIdentifier</key>
  <string>ai.mesh.local-agent</string>
  <key>CFBundleName</key>
  <string>MeshLocalAgent</string>
  <key>CFBundleVersion</key>
  <string>1.0</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>Mesh Local Agent</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>mesh</string>
      </array>
    </dict>
  </array>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>`;

  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist, 'utf8');

  const nodePath = process.execPath;
  const agentBin = path.resolve(__dirname, '../bin/mesh-local.js');
  const executable = `#!/bin/bash\n"${nodePath}" "${agentBin}" --launch "$@"\n`;
  const execPath = path.join(macOSDir, 'mesh-local-handler');
  fs.writeFileSync(execPath, executable, { mode: 0o755, encoding: 'utf8' });

  // Use lsregister to notify Launch Services — hardcoded binary, no user input
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  try {
    execFileSync(lsregister, ['-f', appDir], { stdio: 'ignore' });
  } catch {
    // lsregister unavailable — registration takes effect on next login
  }
}

function registerLinux() {
  const desktopDir = path.join(os.homedir(), '.local', 'share', 'applications');
  fs.mkdirSync(desktopDir, { recursive: true });

  const nodePath = process.execPath;
  const agentBin = path.resolve(__dirname, '../bin/mesh-local.js');
  const desktopPath = path.join(desktopDir, 'mesh-local.desktop');

  const desktop = `[Desktop Entry]\nType=Application\nName=Mesh Local Agent\nExec="${nodePath}" "${agentBin}" --launch %u\nMimeType=x-scheme-handler/mesh\nNoDisplay=true\n`;
  fs.writeFileSync(desktopPath, desktop, 'utf8');

  // Use xdg-mime and update-desktop-database — hardcoded binaries, no user input in args
  try {
    execFileSync('xdg-mime', ['default', 'mesh-local.desktop', 'x-scheme-handler/mesh'], { stdio: 'ignore' });
  } catch { /* xdg-mime not available */ }
  try {
    execFileSync('update-desktop-database', [desktopDir], { stdio: 'ignore' });
  } catch { /* not available */ }
}

function registerWindows() {
  // Uses reg.exe with hardcoded key paths — no user input in registry keys or values
  const nodePath = process.execPath;
  const agentBin = path.resolve(__dirname, '../bin/mesh-local.js');
  const command = `"${nodePath}" "${agentBin}" --launch "%1"`;
  const regExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');

  try {
    execFileSync(regExe, ['add', 'HKCU\\Software\\Classes\\mesh', '/ve', '/d', 'Mesh Local Agent', '/f'], { stdio: 'ignore' });
    execFileSync(regExe, ['add', 'HKCU\\Software\\Classes\\mesh', '/v', 'URL Protocol', '/d', '', '/f'], { stdio: 'ignore' });
    execFileSync(regExe, ['add', 'HKCU\\Software\\Classes\\mesh\\shell\\open\\command', '/ve', '/d', command, '/f'], { stdio: 'ignore' });
  } catch { /* reg.exe not available or permissions issue */ }
}

module.exports = { registerProtocol };
