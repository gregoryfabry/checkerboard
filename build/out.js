(function() {
  var stm;
  if (typeof window === 'undefined' && typeof define !== 'function') { var define = require('amdefine')(module) }
  (function() {/**
 * @license almond 0.3.1 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */

var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                //Lop off the last part of baseParts, so that . matches the
                //"directory" and not name of the baseName's module. For instance,
                //baseName of "one/two/three", maps to "one/two/three.js", but we
                //want the directory, "one/two" for this normalization.
                name = baseParts.slice(0, baseParts.length - 1).concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());

define("node_modules/almond/almond.js", function(){});



define('util',['exports'], function(exports) {
  function isPOJS(obj) {
    return !(
      obj instanceof Date ||
      obj instanceof RegExp ||
      obj instanceof String ||
      obj instanceof Number) &&
      typeof obj === 'object' &&
      obj !== null;
  }

  function getByPath(obj, path) {
    if (path === "")
      return obj;

    var keys = path.split('.');

    for (var i = 0; i < keys.length && obj; i++)
        obj = obj[keys[i]];

    return i >= keys.length ? obj : undefined;
  }

  function wrap(obj, path, root) {
    if (path === "")
      return obj;

    if (typeof root === 'undefined')
      root = {};

    var c = typeof path === 'string' ? path.split('.') : path;
    if (c.length === 1) {
      root[c[0]] = obj;
      return root;
    }

    root[c[0]] = {};
    wrap(obj, c.splice(1), root[c[0]]);

    return root;
  }

  // is b a subdir of or equiv to a?
  function isChild(a, b) {
    if (a === "")
      return true;

    a = a.split('.');
    b = b.split('.');

    var i;
    for (i = 0; i < a.length; i++)
      if (a[i] !== b[i] || i >= b.length)
        return -1;

    return b.length - i;
  }

  exports.isPOJS = isPOJS;
  exports.getByPath = getByPath;
  exports.wrap = wrap;
  exports.isChild = isChild;
});



define('diffpatch',['exports', 'util'], function(exports, util) {
  function diff(origin, comparand) {
    if (!isPOJS(origin) || !isPOJS(comparand))
      throw new Error('Attempting to diff a non-object');
    var delta = {}, props = {};

    var isArray = origin instanceof Array;

    if (!isArray) {
      var originProps = Object.keys(origin), comparandProps = Object.keys(comparand);
      for (var i = 0; i < originProps.length; i++)
        props[originProps[i]] = true;

      for (var i = 0; i < comparandProps.length; i++)
        props[comparandProps[i]] = true;

      props = Object.keys(props);
    }

    var fPropInOrigin, fPropInComparand, fUndefinedInOrigin, fUndefinedInComparand, fTypesMatch, fObjInOrigin, fObjInComparand;
    var prop, oObj, cObj;
    for (var i = 0; i < (isArray ? Math.max(origin.length, comparand.length) : props.length); i++) {
      prop = isArray ? i : props[i];
      oObj = origin[prop];
      cObj = comparand[prop];

      fPropInOrigin = origin.hasOwnProperty(prop);
      fPropInComparand = comparand.hasOwnProperty(prop);
      fUndefinedInOrigin = oObj === void 0;
      fUndefinedInComparand = cObj === void 0;
      fTypesMatch = typeof cObj === typeof oObj && ((cObj === null) === (oObj === null));
      fObjInOrigin = fPropInOrigin && !fUndefinedInOrigin && isPOJS(oObj);
      fObjInComparand = fPropInComparand && !fUndefinedInComparand && isPOJS(cObj);

      if (fPropInOrigin && fUndefinedInOrigin && !fUndefinedInComparand)
        delta[prop] = [1, 1, cObj]; //{_op: 'mu', nmu: cObj};
      else if (fPropInComparand && (!fUndefinedInOrigin && fPropInOrigin) && fUndefinedInComparand)
        delta[prop] = [1, 2, null, oObj]; //{_op: 'su', osu: oObj};
      else if (!fPropInOrigin && fPropInComparand && fUndefinedInComparand)
        delta[prop] = [0, 2];
      else if (!fPropInOrigin && fPropInComparand)
        delta[prop] = [0, 0, cObj]; //{_op: 's', ns: cObj};
      else if (fPropInOrigin && !fPropInComparand)
        delta[prop] = [2, 0, null, oObj]; //{_op: 'd', od: oObj}
      else if (fUndefinedInOrigin && !fPropInComparand)
        delta[prop] = [2, 1]; //{_op: 'du'};
      else if (!fTypesMatch || (fTypesMatch && !fObjInOrigin && !fObjInComparand && oObj !== cObj))
        delta[prop] = [1, 0, cObj, oObj]; //{_op: 'm', om: oObj, nm: cObj};
      else if (fObjInOrigin && fObjInComparand && typeof (subDelta = diff(oObj, cObj)) !== 'undefined')
        delta[prop] = subDelta;
    }

    if (Object.keys(delta).length > 0)
      return delta;
  }

  function reverse(delta) {
    var toReturn = {};
    for (var prop in delta) {
      if (!delta.hasOwnProperty(prop))
        continue;
      if (!(delta[prop] instanceof Array))
        toReturn[prop] = reverse(delta[prop]);
      else {
        toReturn[prop] = [];
        switch(delta[prop][0]) {
          case 0: // set
            toReturn[prop][0] = 2; // delete
            if (delta[prop][1] == 2) // set undefined
              toReturn[prop][1] = 1;
            else {
              toReturn[prop][1] = 0;
              toReturn[prop][2] = null;
              toReturn[prop][3] = delta[prop][2];
            }
            break;
          case 1:
            toReturn[prop][0] = 1;
            if (delta[prop][1] === 0) {
              toReturn[prop][1] = 0;
              toReturn[prop][2] = delta[prop][3];
              toReturn[prop][3] = delta[prop][2];
            } else if (delta[prop][1] === 1) {
              toReturn[prop][1] = 2;
              toReturn[prop][2] = null;
              toReturn[prop][3] = delta[prop][2];
            } else {
              toReturn[prop][1] = 1;
              toReturn[prop][2] = delta[prop][3];
            }
            break;
          case 2:
            toReturn[prop][0] = 0;
            if (delta[prop][1] === 0) {
              toReturn[prop][1] = 0;
              toReturn[prop][2] = delta[prop][3];
            } else {
              toReturn[prop][1] = 2;
            }
            break;
        }
      }
    }
    return toReturn;
  }

  var placeholder = {};
  function patch(target, delta, checked, recur) {
    if (typeof recur === 'undefined')
      delta = JSON.parse(JSON.stringify(delta));

    if (typeof delta === 'undefined')
      return true;

    if (typeof checked === 'undefined' && !check(target, delta)) {
      return false;
    }

    Object.keys(delta).forEach(function(prop) {
      if (!(delta[prop] instanceof Array)) {
        patch(target[prop], delta[prop], true, true);
        if (target[prop] instanceof Array) {
          var newArray = [];

          for (var i = 0; i < target[prop].length; i++)
            if (target[prop][i] !== placeholder)
              newArray[newArray.length] = target[prop][i];

          target[prop] = newArray;
        }
      } else {
        switch(delta[prop][0]) {
          case 0:
          case 1:  target[prop] = delta[prop][1] !== 2 ? delta[prop][2] : undefined;   break;
          case 2:
            if (target instanceof Array)
              target[prop] = placeholder;
            else
              delete target[prop];
        }
      }
    });
    return true;
  }

  function check(target, delta) {
    if (typeof target === 'undefined' || typeof delta === 'undefined')
      return typeof target === 'undefined' && typeof delta === 'undefined';
    return Object.keys(delta).every(function(prop) {
      if (!(delta[prop] instanceof Array))
        return check(target[prop], delta[prop]);
      try {
        switch(delta[prop][0]) {
          case 0: return !(prop in target);
          case 1:
          case 2: return deepequals(target[prop], delta[prop][3]);
        }
      } catch (e) {
        return false;
      }
    });
  }

  function deepequals(origin, comparand, props) {
    if (!isPOJS(origin))
      return origin === comparand;

    if (typeof props === 'undefined')
      [].push.apply(props = Object.keys(origin), Object.keys(comparand));

    for (var i = 0, isObj; i < props.length; i++) {
      if (typeof origin[props[i]] !== typeof comparand[props[i]] || ((isObj = isPOJS(origin[props[i]])) !== isPOJS(comparand[props[i]])) )
        return false;
      else if (isObj && !deepequals(origin[props[i]], comparand[props[i]]))
        return false;
      else if (!isObj && origin[props[i]] !== comparand[props[i]])
        return false;
    }

    return true;
  }

  function isPOJS(obj) {
    return !(
      obj instanceof Date ||
      obj instanceof RegExp ||
      obj instanceof String ||
      obj instanceof Number) &&
      typeof obj === 'object' &&
      obj !== null;
  }

  exports.diff = diff;
  exports.patch = patch;
  exports.reverse = reverse;
});



define('stm',['exports', 'diffpatch', 'util'], function(exports, diffpatch, util) {
  var noop = function(){};

  var diff = diffpatch.diff;
  var patch = diffpatch.patch;
  var isPOJS = util.isPOJS;
  var getByPath = util.getByPath;
  var wrap = util.wrap;
  var isChild = util.isChild;

  function STM(addressOrWs) {
    if (typeof addressOrWs === "string")
      this.ws = new WebSocket(addressOrWs);
    else if (addressOrWs instanceof WebSocket)
      this.ws = addressOrWs;
    else
      throw new Error("invalid websocket config");

    var ws = this.ws;

    var actions = {};
    var store = null;
    var observers = {};

    var attemptID = 0;
    var syncInterval = null;

    var pending = [];
    var queue = [];

    var initialized = false;
    var initFunction = function(){};
    var waitingForReturn = false;

    this.lib = {
      'diffpatch': diffpatch,
      'util': util
    };

    var that = this;

    ws.addEventListener('message', function(event) {
      var envelope = JSON.parse(event.data);
      switch(envelope.channel) {
        case 'attempt-returned':
          for (var i = 0; i < pending.length; i++)
            if (envelope.message.successes.indexOf(pending[i].id) > -1)
              pending.splice(i--, 1);

          if (pending.length === 0) {
            waitingForReturn = false;
            sync();
            break;
          }

          var cur, saved = [];
          while (typeof (cur = queue.pop()) !== 'undefined' || typeof (cur = pending.pop()) !== 'undefined') {
            saved.unshift(cur);
            applyQuick(actions[cur.channel].onRevert, getByPath(store, cur.path), cur.params);
          }

          for (var p in envelope.message.fixes) {
            if (!envelope.message.fixes.hasOwnProperty(p))
              continue;
            if (p === '')
              store = envelope.message.fixes[p];
            else {
              var components = p.split('.');
              var root = getByPath(store, components.slice(0, components.length - 1).join('.'));
              root[components[components.length - 1]] = envelope.message.fixes[p]
            }
          }

          prepareRecursive(store);

          for (var i = 0; i < saved.length; i++) {
            if (typeof saved[i].params === 'undefined')
              saved[i].params = [];
            saved[i].params.unshift(saved[i].channel);
            applyQuick(sendAction, {__stm: that, __path: saved[i].path}, saved[i].params);
          }

          waitingForReturn = false;
          sync();
          break;
        case 'set-state':
          store = prepareRecursive(envelope.message.data);
          initialized = true;
          initFunction(store);
          break;
        case 'update-state':
          for (var i = 0; i < envelope.message.deltas.length; i++)
            patchAndNotify(envelope.message.deltas[i], store, observers, this);
          break;
      }
    });

    // public functions
    var action = this.action = function(name) {
      if (!(typeof name === "string"))
        throw new Error("invalid action name");

      var a = actions[name] = {'onReceive': noop, 'onRevert': noop};

      return {
        onReceive: function(callback) {
          if (!(typeof callback === "function"))
            throw new Error("invalid callback");
          a.onReceive = callback;
          return this;
        },
        onRevert: function(callback) {
          if (!(typeof callback === "function"))
            throw new Error("invalid callback");
          a.onRevert = callback;
          return this;
        }
      };
    };

    var init = this.init = function(callback) {
      if (!(typeof callback === "function"))
        throw new Error("invalid callback");
      initFunction = callback;
      if (initialized)
        initFunction(store);
    };

    var sync = this.sync = function(interval) {
      if (typeof interval === 'undefined' && syncInterval === null)
        syncOp()
      else if (typeof interval === null && syncInterval !== null) {
        clearInterval(syncInterval);
        syncInterval = null;
      }
      else if (typeof interval !== 'undefined') {
        if (syncInterval !== null)
          clearInterval(syncInterval);

        syncInterval = setInterval(syncOp, interval);
      }
    };

    function addObserver(callback, depth) {
      if (!('__stm' in this))
        throw new Error('addObserver called on unprepared object');
      if (!(typeof callback === "function"))
        throw new Error("invalid callback");
      var path = this.__path;

      if (!initialized)
        throw new Error("observer added before initialization");

      if (typeof observers[path] === 'undefined')
        observers[path] = [];

      observers[path].push({'callback': callback, 'depth': depth});
      send('subscribe', {'path': path, 'depth': depth});

      callback(getByPath(store, path), null);
    }

    function sendAction(channel) {
      if (!('__stm' in this))
        throw new Error('sendAction called on unprepared object');

      var path = this.__path;
      var params = [];
      for (var i = 1; i < arguments.length; i++)
        params[i - 1] = arguments[i];

      if (!initialized)
        throw new Error("action sent added before initialization");

      if (typeof channel !== 'string' || !(channel in actions))
        throw new Error("invalid action");

      var origin = getByPath(store, path);
      if (origin === null)
        throw new Error("invalid path");

      var comparand = JSON.parse(JSON.stringify(origin));

      var extPath = applyQuick(actions[channel].onReceive, comparand, params);
      if (extPath === false)
        return;

      if (typeof extPath === 'string') {
        origin = {'toDiff': getByPath(origin, extPath)};
        comparand = {'toDiff': getByPath(comparand, extPath)};
      }

      var delta = diff(origin, comparand);


      if (typeof delta === 'undefined')
        return;

      if (typeof extPath === 'string') {
        newDelta = {};
        var paths = extPath.split('.');
        newDelta[paths[paths.length - 1]] = delta.toDiff;
        paths.pop();
        if (paths.length > 0)
          path += '.' + paths.join('.');
        delta = newDelta;
      }

      var attempt = new Attempt({'id': attemptID++, 'path': path, 'channel': channel, 'params': params, 'delta': delta});
      patchAndNotify(attempt);

      queue.push(attempt);
      sync();
    }

    function syncOp() {
      if (waitingForReturn || queue.length === 0 || !initialized)
        return;
      waitingForReturn = true;
      send('attempt', {'attempts': queue});
      applyQuick(pending.push, pending, queue.splice(0, queue.length));
    }

    function send(channel, message) {
      ws.send(JSON.stringify({'channel': channel, 'message': message}));
    }

    function prepareRecursive(obj, path) {
      if (typeof path === 'undefined')
        path = [];

      if (isPOJS(obj)) {
        if (!obj.hasOwnProperty('__path')) {
          Object.defineProperties(obj, {
            '__path': {
              value: path.join("."),
            },
            '__stm': {
              value: that
            },
            'addObserver': {
              value: addObserver
            },
            'sendAction': {
              value: sendAction
            }
          });
        }
        for (var p in obj) {
          if (p != '__path' && p != '__stm' && p != 'addObserver' && p != 'sendAction') {
            path.push(p);
            prepareRecursive(obj[p], path);
            path.pop();
          }
        }
      }

      return obj;
    }

    function patchAndNotify(attempt) {
      var origin = JSON.parse(JSON.stringify(store));
      patch(getByPath(store, attempt.path), attempt.delta, true);
      prepareRecursive(getByPath(store, attempt.path), attempt.path !== '' ? attempt.path.split('.') : undefined);

      for (var path in observers) {
        if (typeof getByPath(wrap(attempt.delta, attempt.path), path) !== 'undefined' && isPOJS(getByPath(origin, path))) {
          for (var j = 0; j < observers[path].length; j++) {
            observers[path][j].callback(getByPath(store, path), getByPath(origin, path));
          }
        }
      }
    }
  }

  function Attempt(params) {
    var props = Object.keys(params);
    for (var i = 0; i < props.length; i++)
      this[props[i]] = params[props[i]];
  }

  Attempt.prototype.toJSON = function() {
    return {'id': this.id, 'path': this.path, 'delta': this.delta};
  };

  function applyQuick(fn, thisArg, params) {
    switch(params.length) {
      case 0: return fn.call(thisArg);
      case 1: return fn.call(thisArg, params[0]);
      case 2: return fn.call(thisArg, params[0], params[1]);
      case 3: return fn.call(thisArg, params[0], params[1], params[2]);
      case 4: return fn.call(thisArg, params[0], params[1], params[2], params[3]);
      case 5: return fn.call(thisArg, params[0], params[1], params[2], params[3], params[4]);
      default: return fn.apply(thisArg, params);
    }
  }

  exports.STM = STM;
});

  stm = require('stm');
  })();
  if (window) {
    if (typeof window.define !== 'undefined')
      window.define('checkerboard', stm);
    else
      window.checkerboard = stm;
  }
}());