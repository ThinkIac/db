var createDatabase, createRequire, fs, path, provideDb, requireCapabilityDependency;

fs = require('fs');

path = require('path');

({createRequire} = require('module'));

createDatabase = function(host) {
  var addTenant, getDocuments, getProxy, getScriba, install, instantiate, loadError, loadScribaFrom, missing, openPrivate, resolveDatabasePath, scriba, tried, valid, vault;
  scriba = null;
  tried = false;
  loadError = null;
  valid = function(value) {
    return /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value);
  };
  missing = function(error) {
    return error && error.code === 'MODULE_NOT_FOUND' && /Cannot find module ['\"]scriba['\"]/.test(error.message);
  };
  instantiate = function(module) {
    var Type, absent, instance;
    Type = module && (module.default || module);
    if (typeof Type !== 'function') {
      throw new Error('SCRIBA_INCOMPATIBLE_API: default export is not a constructor');
    }
    instance = new Type();
    absent = ['addTenant', 'entity', 'tenants'].filter(function(name) {
      return typeof instance[name] !== 'function';
    });
    if (absent.length) {
      throw new Error(`SCRIBA_INCOMPATIBLE_API: missing ${absent.join(', ')}`);
    }
    return instance;
  };
  loadScribaFrom = function(root) {
    var current, error, last, parent;
    current = root;
    last = void 0;
    while (true) {
      try {
        return instantiate(createRequire(path.join(current, 'package.json'))('scriba'));
      } catch (error1) {
        error = error1;
        if (!missing(error) && !(error && String(error.message).startsWith('SCRIBA_INCOMPATIBLE_API'))) {
          throw error;
        }
        last = last || error;
      }
      parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
    try {
      return instantiate(require('scriba'));
    } catch (error1) {
      error = error1;
      if (!missing(error) && !(error && String(error.message).startsWith('SCRIBA_INCOMPATIBLE_API'))) {
        throw error;
      }
      throw last || error;
    }
  };
  getScriba = function() {
    var error, incompatible, message;
    if (tried) {
      return scriba;
    }
    tried = true;
    try {
      scriba = loadScribaFrom(host.applicationRoot());
    } catch (error1) {
      error = error1;
      incompatible = error && String(error.message).startsWith('SCRIBA_INCOMPATIBLE_API');
      message = missing(error) ? 'SCRIBA_MODULE_MISSING' : incompatible ? error.message : 'SCRIBA_INITIALIZATION_FAILED';
      loadError = new Error(message, {
        cause: error
      });
      host.log(`[db] ${loadError.message}`);
      host.appendLog('logos', 'db:initialize', loadError);
      scriba = null;
    }
    return scriba;
  };
  resolveDatabasePath = function(folder, dir) {
    var dataDir, target;
    dataDir = host.dataDir();
    if (!dataDir) {
      return path.join(dir, '.database');
    }
    target = path.join(dataDir, 'db', folder);
    fs.mkdirSync(target, {
      recursive: true
    });
    return path.join(target, '.database');
  };
  vault = function(container) {
    var instance, state;
    state = container.state('private-vault');
    instance = state.get('instance');
    if (!instance) {
      instance = host.createVault(container.config && container.config.privateVault || {});
      state.set('instance', instance);
    }
    return instance;
  };
  openPrivate = function(container, filename, key) {
    var factory;
    factory = container.config && container.config.privateVault && container.config.privateVault.databaseFactory;
    try {
      if (factory) {
        return factory(filename, key);
      } else {
        return host.openPrivateDatabase(filename, key);
      }
    } finally {
      key.fill(0);
    }
  };
  addTenant = function({packageName, dir}) {
    var instance, ref;
    instance = getScriba();
    if (instance) {
      instance.addTenant({
        id: packageName,
        path: resolveDatabasePath(packageName, dir),
        schema: ((ref = host.composeSchema(dir)) != null ? ref.outputPath : void 0) || `${dir}/schema.prisma`,
        watchSchema: false
      });
    }
  };
  getProxy = function(tenant) {
    var authority;
    authority = host.currentAuthority();
    authority.access && authority.access.enforce({
      principal: authority.principal,
      surface: 'database',
      operation: 'access',
      resource: tenant
    });
    return new Proxy({}, {
      get: function(_target, entity) {
        var instance;
        if (typeof entity !== 'string') {
          return;
        }
        instance = getScriba();
        if (!instance) {
          throw loadError || new Error('SCRIBA_UNAVAILABLE');
        }
        return instance.entity(entity, tenant);
      }
    });
  };
  getDocuments = async function(container, tenant) {
    var authority, instance, open, pending, pkg;
    authority = host.currentAuthority();
    authority.access && authority.access.enforce({
      principal: authority.principal,
      surface: 'database',
      operation: 'access',
      resource: tenant
    });
    if (!valid(tenant)) {
      throw new Error('INVALID_DATABASE_TENANT');
    }
    pkg = container.registry.getPackage(tenant);
    if (!fs.existsSync(path.join(pkg.dir, 'package.json'))) {
      throw new Error('DATABASE_PACKAGE_NOT_FOUND');
    }
    instance = getScriba();
    if (!(instance && instance.documents)) {
      throw new Error('SCRIBA_DOCUMENTS_UNAVAILABLE');
    }
    pending = container.state('db:documents');
    if (!pending.has(tenant)) {
      open = (async function() {
        var filename, key;
        if (false) {
          // Preserve asynchronous opening and sharing of concurrent requests.
          await void 0;
        }
        if (!instance.tenants().includes(tenant)) {
          if (fs.existsSync(path.join(pkg.dir, 'schema.prisma'))) {
            throw new Error('DATABASE_NOT_READY');
          }
          filename = resolveDatabasePath(tenant, pkg.dir);
          if (pkg.database === 'private') {
            key = (await vault(container).keyFor(tenant));
            if (!instance.tenants().includes(tenant)) {
              instance.addTenant({
                id: tenant,
                path: filename,
                databaseFactory: function() {
                  return openPrivate(container, filename, key);
                }
              });
            }
          } else {
            instance.addTenant({
              id: tenant,
              path: filename
            });
          }
        }
        return instance.documents(tenant);
      })();
      pending.set(tenant, open);
      open.catch(function() {
        if (pending.get(tenant) === open) {
          return pending.delete(tenant);
        }
      });
    }
    return (await pending.get(tenant));
  };
  install = function(container) {
    var registered;
    registered = container.state('db');
    container.bus.on('package:wiring', async function(payload) {
      var composed, err, filename, instance, key, pkg;
      pkg = payload.pkg;
      if (registered.has(pkg.folder)) {
        return;
      }
      try {
        composed = host.composeSchema(pkg.dir);
      } catch (error1) {
        err = error1;
        host.appendLog(pkg.folder, 'db:composeSchema', err);
        return;
      }
      if (!composed) {
        return;
      }
      instance = getScriba();
      if (!instance) {
        return;
      }
      try {
        filename = resolveDatabasePath(pkg.folder, pkg.dir);
        if (pkg.database === 'private') {
          key = (await vault(container).keyFor(pkg.folder));
          await instance.addTenant({
            id: pkg.folder,
            path: filename,
            schema: composed.outputPath,
            watchSchema: false,
            databaseFactory: function() {
              return openPrivate(container, filename, key);
            }
          });
        } else {
          await instance.addTenant({
            id: pkg.folder,
            path: filename,
            schema: composed.outputPath,
            watchSchema: false
          });
        }
        registered.set(pkg.folder, true);
        await container.bus.emit('db:schema_composed', {
          pkg: pkg.folder,
          sources: composed.sources.map(function(source) {
            return path.relative(pkg.dir, source);
          })
        });
      } catch (error1) {
        err = error1;
        host.appendLog(pkg.folder, 'db:addTenant', err);
      }
    }, {
      priority: 20
    });
    container.bus.on('db:schema_changed', async function(payload) {
      var composed, err, folder, instance, pkg;
      folder = payload && payload.pkg;
      if (!(folder && registered.has(folder))) {
        return;
      }
      pkg = container.registry.getPackage(folder);
      try {
        composed = host.composeSchema(pkg.dir);
        if (!composed) {
          return;
        }
        instance = getScriba();
        if (!(instance && instance.reloadTenantSchema)) {
          throw new Error('SCRIBA_SCHEMA_RELOAD_UNAVAILABLE');
        }
        await instance.reloadTenantSchema(folder, composed.outputPath);
        await container.bus.emit('db:schema_composed', {
          pkg: folder,
          sources: composed.sources.map(function(source) {
            return path.relative(pkg.dir, source);
          })
        });
      } catch (error1) {
        err = error1;
        host.appendLog(folder, 'db:reloadSchema', err);
        await container.bus.emit('db:schema_compose_failed', {
          pkg: folder,
          error: err instanceof Error ? err.message : String(err)
        });
        throw err;
      }
    }, {
      priority: 20
    });
    container.bus.once('runtime:packages_wired', function() {
      var instance;
      try {
        instance = getScriba();
        instance && instance._injectGlobals && instance._injectGlobals();
      } catch (error1) {
        void 0;
      }
    });
  };
  return {loadScribaFrom, resolveDatabasePath, getScriba, addTenant, getProxy, getDocuments, install};
};

provideDb = function(host) {
  /*
  @register module db
  @context capability
  */
  var db;
  db = createDatabase({
    applicationRoot: host.applicationRoot,
    dataDir: host.dataDir,
    composeSchema: require('./schema-composer.cjs').composePackageSchema,
    appendLog: host.appendLog,
    currentAuthority: host.currentAuthority,
    createVault: function(options) {
      return new (require('./private-vault.cjs').PrivateVault)(options);
    },
    openPrivateDatabase: require('./private-vault.cjs').openSqlCipherDatabase,
    log: host.log
  });
  return {
    name: 'db',
    phase: 'boot',
    swappable: false,
    api: db,
    capabilities: {
      database: function(request, context) {
        var method, record, ref, ref1, table;
        if (request.tenant !== context.package) {
          throw new Error('An isolated package can only access its own database');
        }
        if (request.operation === 'index') {
          if (!(typeof request.entity === 'string' && typeof request.key === 'string')) {
            throw new Error('Invalid database index request');
          }
          table = db.getProxy(context.package)[request.entity];
          record = table[request.key];
          if (record === void 0) {
            return void 0;
          }
          if (!(record && typeof record.toJSON === 'function')) {
            throw new Error('Database index did not resolve a record');
          }
          return Object.fromEntries(table._fields.map(function(field) {
            return [field.name, record[field.name]];
          }));
        }
        if (!(typeof request.entity === 'string' && typeof request.method === 'string' && Array.isArray(request.args))) {
          throw new Error('Invalid database capability request');
        }
        method = (ref = db.getProxy(context.package)) != null ? (ref1 = ref[request.entity]) != null ? ref1[request.method] : void 0 : void 0;
        if (typeof method !== 'function') {
          throw new Error(`Unknown database operation: ${request.entity}.${request.method}`);
        }
        return method(...request.args);
      }
    },
    install: function() {
      // The host supplies protocol ports; no Logos internals are imported.
      db.install({
        state: host.state,
        bus: {
          on: host.on,
          once: host.once,
          emit: host.emit
        },
        registry: host.registry,
        config: host.config()
      });
    }
  };
};

requireCapabilityDependency = function(name, local) {
  var entry, error;
  try {
    entry = require.resolve(name);
  } catch (error1) {
    error = error1;
    if (error.code !== 'MODULE_NOT_FOUND') {
      throw error;
    }
    entry = require.resolve(local);
  }
  return require(entry);
};

module.exports = {createDatabase, provideDb};

module.exports.createHost = function(...args) {
  return requireCapabilityDependency('@thinkiac/module-runtime-compat', '../runtime-compat').createHost(...args);
};

module.exports.createRuntimeModule = provideDb;
