'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), '.mesh-local.json');

/**
 * Loads persisted config from ~/.mesh-local.json.
 * @returns {{ token?: string, token_server?: string, protocol_registered?: boolean }}
 */
function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Merges and saves config to ~/.mesh-local.json.
 * @param {object} updates
 */
function saveConfig(updates) {
  const current = loadConfig();
  const merged = { ...current, ...updates };
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
  } catch (err) {
    console.warn('Warning: could not save config:', err.message);
  }
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH };
