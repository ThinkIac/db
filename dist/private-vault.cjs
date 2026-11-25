var MASTER_KEY_BYTES, PrivateVault, PrivateVaultUnavailableError, SERVICE, execFile, execFileAsync, execWithStdin, hkdfSync, keyMaterial, openSqlCipherDatabase, platformKeyring, promisify, randomBytes, scryptSync, spawn;

({execFile, spawn} = require('node:child_process'));

({randomBytes, scryptSync, hkdfSync} = require('node:crypto'));

({promisify} = require('node:util'));

execFileAsync = promisify(execFile);

SERVICE = 'logos.private-vault.v1';

MASTER_KEY_BYTES = 32;

PrivateVaultUnavailableError = class PrivateVaultUnavailableError extends Error {
  constructor(message = 'Private database requires an OS keyring or an explicit in-memory unlock provider') {
    super(message);
    this.name = 'PrivateVaultUnavailableError';
    this.code = 'PRIVATE_VAULT_UNAVAILABLE';
  }

};

keyMaterial = function(value) {
  var output;
  output = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
  if (output.length < MASTER_KEY_BYTES) {
    throw new PrivateVaultUnavailableError('Private vault master key must contain at least 32 bytes');
  }
  return output;
};

execWithStdin = function(command, args, input) {
  return new Promise(function(resolve, reject) {
    var child, stderr;
    child = spawn(command, args, {
      stdio: ['pipe', 'ignore', 'pipe']
    });
    stderr = '';
    child.stderr.on('data', function(chunk) {
      return stderr += String(chunk);
    });
    child.once('error', reject);
    child.once('close', function(code) {
      if (code === 0) {
        return resolve();
      } else {
        return reject(new Error(stderr.trim() || `${command} exited with ${code}`));
      }
    });
    return child.stdin.end(input);
  });
};

// Preserve the platform adapters, including the existing macOS security CLI.
platformKeyring = function(account = 'default') {
  if (process.platform === 'darwin') {
    return {
      get: async function() {
        var stdout;
        try {
          ({stdout} = (await execFileAsync('security', ['find-generic-password', '-w', '-s', SERVICE, '-a', account])));
          return Buffer.from(stdout.trim(), 'base64');
        } catch (error1) {
          return null;
        }
      },
      set: async function(value) {
        await execFileAsync('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', account, '-w', value.toString('base64')]);
      }
    };
  }
  if (process.platform === 'linux') {
    return {
      get: async function() {
        var stdout;
        try {
          ({stdout} = (await execFileAsync('secret-tool', ['lookup', 'service', SERVICE, 'account', account])));
          return Buffer.from(stdout.trim(), 'base64');
        } catch (error1) {
          return null;
        }
      },
      set: async function(value) {
        await execWithStdin('secret-tool', ['store', '--label=Lógos private vault', 'service', SERVICE, 'account', account], value.toString('base64'));
      }
    };
  }
  return null;
};

PrivateVault = class PrivateVault {
  constructor(options = {}) {
    var ref;
    this.options = options;
    this.masterKey = null;
    this.keyring = this.options.keyring === void 0 ? platformKeyring() : this.options.keyring;
    this.random = (ref = this.options.randomBytes) != null ? ref : randomBytes;
  }

  async unlock() {
    var base, base1, error, fromKeyring, generated, password, ref, ref1, supplied;
    if (this.masterKey) {
      return this.masterKey;
    }
    supplied = (await (typeof (base = this.options).masterKeyProvider === "function" ? base.masterKeyProvider() : void 0));
    if (supplied) {
      return this.masterKey = keyMaterial(supplied);
    }
    fromKeyring = (await ((ref = this.keyring) != null ? ref.get() : void 0));
    if (fromKeyring != null ? fromKeyring.length : void 0) {
      return this.masterKey = keyMaterial(fromKeyring);
    }
    password = (await (typeof (base1 = this.options).passwordProvider === "function" ? base1.passwordProvider() : void 0));
    if (password) {
      return this.masterKey = scryptSync(password, SERVICE, MASTER_KEY_BYTES, {
        N: 1 << 17,
        r: 8,
        p: 1,
        maxmem: 256 * 1024 * 1024
      });
    }
    if (!this.keyring) {
      throw new PrivateVaultUnavailableError();
    }
    generated = this.random(MASTER_KEY_BYTES);
    try {
      await this.keyring.set(generated);
      return this.masterKey = Buffer.from(generated);
    } catch (error1) {
      error = error1;
      generated.fill(0);
      throw new PrivateVaultUnavailableError(`OS keyring could not store the private vault key: ${(ref1 = error != null ? error.message : void 0) != null ? ref1 : 'unknown error'}`);
    }
  }

  // Callers erase the derived key after handing it to the driver.
  async keyFor(packageName) {
    var master;
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(packageName)) {
      throw new TypeError('Private vault package name is invalid');
    }
    master = (await this.unlock());
    return Buffer.from(hkdfSync('sha256', master, Buffer.from(SERVICE), Buffer.from(`package:${packageName}`), MASTER_KEY_BYTES));
  }

};

openSqlCipherDatabase = function(databasePath, key) {
  var Database, database, error;
  database = void 0;
  try {
    Database = require('better-sqlite3-multiple-ciphers');
    database = new Database(databasePath);
    database.pragma("cipher = 'sqlcipher'");
    database.pragma('legacy = 4');
    if (typeof database.key !== 'function') {
      throw new Error('SQLCipher driver does not expose key(Buffer)');
    }
    database.key(key);
    database.pragma('kdf_iter = 256000');
    database.pragma('cipher_memory_security = ON');
    database.pragma('secure_delete = ON');
    database.prepare('SELECT count(*) AS count FROM sqlite_master').get();
    return database;
  } catch (error1) {
    error = error1;
    try {
      if (database != null) {
        database.close();
      }
    } catch (error1) {
      void 0;
    }
    throw error;
  } finally {
    key.fill(0);
  }
};

Object.defineProperty(exports, '__esModule', {
  value: true
});

Object.assign(exports, {PrivateVault, PrivateVaultUnavailableError, platformKeyring, openSqlCipherDatabase});
