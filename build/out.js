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



define('diffpatch',['exports'], function(exports) {
  function diff(origin, comparand) {
    if (!isPOJS(origin) || !isPOJS(comparand))
      throw new Error('Attempting to diff a non-object');
    var delta = {}, props = [];
    
    var originProps = Object.keys(origin), comparandProps = Object.keys(comparand);
    [].push.apply(props, originProps);
    [].push.apply(props, comparandProps);
    props = props.filter(function(element, index, array) {
      return this.hasOwnProperty(element) ? false : this[element] = true;
    }, {});
    
    var fPropInOrigin, fPropInComparand, fUndefinedInOrigin, fUndefinedInComparand, fTypesMatch, fObjInOrigin, fObjInComparand;
    for (var i = 0; i < props.length; i++) {
      fPropInOrigin = props[i] in origin;
      fPropInComparand = props[i] in comparand;
      fUndefinedInOrigin = typeof origin[props[i]] === 'undefined';
      fUndefinedInComparand = typeof comparand[props[i]] === 'undefined';
      fTypesMatch = typeof comparand[props[i]] === typeof origin[props[i]];
      fObjInOrigin = fPropInOrigin && !fUndefinedInOrigin && isPOJS(origin[props[i]]);
      fObjInComparand = fPropInComparand && !fUndefinedInComparand && isPOJS(comparand[props[i]]);
      
      if (fPropInOrigin && fUndefinedInOrigin && !fUndefinedInComparand)
        delta[props[i]] = [1, 1, comparand[props[i]]]; //{_op: 'mu', nmu: comparand[props[i]]};
      else if (fPropInComparand && (!fUndefinedInOrigin && fPropInOrigin) && fUndefinedInComparand)
        delta[props[i]] = [1, 2, null, origin[props[i]]]; //{_op: 'su', osu: origin[props[i]]};
      else if (!fPropInOrigin && fPropInComparand && fUndefinedInComparand)
        delta[props[i]] = [0, 2];
      else if (!fPropInOrigin && fPropInComparand)
        delta[props[i]] = [0, 0, comparand[props[i]]]; //{_op: 's', ns: comparand[props[i]]};
      else if (fPropInOrigin && !fPropInComparand)
        delta[props[i]] = [2, 0, null, origin[props[i]]]; //{_op: 'd', od: origin[props[i]]}
      else if (fUndefinedInOrigin && !fPropInComparand)
        delta[props[i]] = [2, 1]; //{_op: 'du'};
      else if (!fTypesMatch || (fTypesMatch && !fObjInOrigin && !fObjInComparand && origin[props[i]] !== comparand[props[i]]))
        delta[props[i]] = [1, 0, comparand[props[i]], origin[props[i]]]; //{_op: 'm', om: origin[props[i]], nm: comparand[props[i]]};
      else if (fObjInOrigin && fObjInComparand && typeof (subDelta = diff(origin[props[i]], comparand[props[i]])) !== 'undefined')
        delta[props[i]] = subDelta;
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
              toReturn[prop][2] = null
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

  function patch(target, delta, checked) {
    if (typeof delta === 'undefined')
      return true;
    
    if (delta instanceof Array) {
      target = {0: target};
      delta = {0: delta};
    }
    
    if (typeof checked === 'undefined' && !check(target, delta))
      return false;
      
    Object.keys(delta).forEach(function(prop) {
      if (!(delta[prop] instanceof Array))
        patch(target[prop], delta[prop], true);
      else {
        switch(delta[prop][0]) {
          case 0:  
          case 1:  target[prop] = delta[prop][1] !== 2 ? delta[prop][2] : undefined;   break;
          case 2:
            if (target instanceof Array)
              target.splice(prop, 1)
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
      };
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
  
  function getByPath(obj, keyPath){ 
 
    var keys, keyLen, i=0, key;
    keys = keyPath && keyPath.split(".");
    keyLen = keys && keys.length;
 
    while(i < keyLen && obj){
 
        key = keys[i];        
        obj = (typeof obj.get == "function") 
                    ? obj.get(key)
                    : obj[key];                    
        i++;
    }
 
    if(i < keyLen){
        obj = null;
    }
 
    return obj;
  }
  
  function wrap(obj, path, root) {
    if (typeof root === 'undefined')
      root = {};

    var c = typeof path === 'string' ? path.split('.') : path;
    if (c.length === 1) {
      root[c[0]] = obj;
      return;
    }
    
    root[c[0]] = {};
    wrap(obj, c.splice(1), root[c[0]]);
    
    return root;
  };
  
  exports.diff = diff;
  exports.patch = patch;
  exports.reverse = reverse;
  exports.isPOJS = isPOJS;
  exports.getByPath = getByPath;
  exports.wrap = wrap;
});



define('stm',['exports', 'diffpatch'], function(exports, diffpatch) {
  var noop = function(){};
  
  var diff = diffpatch.diff;
  var patch = diffpatch.patch;
  var reverse = diffpatch.reverse;
  var isPOJS = diffpatch.isPOJS;
  var getByPath = diffpatch.getByPath;
  var wrap = diffpatch.wrap;
  
  Object.prototype.addObserver = function(callback) {
    if (!('__stm' in this))
      throw new Error('addObserver called on unprepared object');
    this.__stm.addObserver(this.__path, callback);
  };
  
  Object.prototype.sendAction = function(channel) {
    if (!('__stm' in this))
      throw new Error('sendAction called on unprepared object');
    this.__stm.sendAction(this.__path, channel, Array.prototype.slice.call(arguments, 1));
  }
    
  function STM(ws) {
    this.ws = ws;
    
    this.actions = {};
    this.store = prepareRecursive(this, {});
    this.observers = {};
    
    this.attemptID = 0;
    this.updateID = null;
    this.syncInterval = null;
    
    this.pending = [];
    this.queue = [];
    
    this.populated = false;
    this.waitingForReturn = false;
 
    var that = this;
    this.ws.addEventListener('message', function(event) {
      var envelope = JSON.parse(event.data);
      switch(envelope.channel) {
        case 'attempt-returned':
          for (var i = 0; i < that.pending.length; i++)
            if (envelope.message.successes.indexOf(that.pending[i].id) > -1)
              that.pending.splice(i, 1);
            
            var cur, saved = [];
            while (typeof (cur = that.pending.pop()) !== 'undefined') {
              if (this.populated)
                patch(getByPath(that.store, cur.path), reverse(cur.delta));
              saved.unshift(cur);
            }
            
            prepareRecursive(that.store);
                        
            for (var i = 0; i < saved.length; i++)
              that.sendAction(saved[i].path, saved[i].channel, saved[i].params);
              
            that.waitingForReturn = false;
            that.sync();
          break;
        case 'set-state':
          that.populated = true;
          that.store = prepareRecursive(that, envelope.message.data);
          break;
        case 'update-state':
          for (var i = 0; i < envelope.message.deltas.length; i++)
            patch(that.store, envelope.message.deltas[i]);
          break;
      }
    });
  };

  STM.prototype.send = function(channel, message) {
    this.ws.send(JSON.stringify({'channel': channel, 'message': message}));
  };
  
  STM.prototype.action = function(name) {
    this.actions[name] = {};
    
    var that = this;
    return {
      onReceive: function(callback) {
        that.actions[name].onReceive = callback;
      },
      onRevert: function(callback) {
        that.actions[name].onRevert = callback;
      }
    };
  };
  
  STM.prototype.addObserver = function(path, callback) {
    this.observers[path] = callback;
    this.send('subscribe', {'path': path});
  }
  
  STM.prototype.sendAction = function(path, channel, params) {  
    if (!(channel in this.actions))
      throw new Error("invalid action");
   
    var origin = getByPath(this.store, path); 
    if (origin === null)
      throw new Error("invalid path");
    
    var comparand = JSON.parse(JSON.stringify(origin));
    
    this.actions[channel].onReceive.apply(comparand, params);
    var delta = diff(origin, comparand);
    
    if (typeof delta === 'undefined')
      return;
    
    patch(origin, delta);
    prepareRecursive(this, origin);
    
    this.queue.push(new Attempt({'id': this.attemptID++, 'path': path, 'channel': channel, 'params': params, 'delta': delta}));
    this.sync();
  };
  
  function Attempt(params) {
    var props = Object.keys(params);
    for (var i = 0; i < props.length; i++)
      this[props[i]] = params[props[i]];
  };
  
  Attempt.prototype.toJSON = function() {
    return {'id': this.id, 'path': this.path, 'delta': this.delta};
  };
  
  STM.prototype.sync = function(interval) {    
    if (typeof interval === 'undefined' && this.syncInterval === null)
      syncOp.call(this);
    else if (typeof interval === null && this.syncInterval !== null) {
      clearInterval(this.syncInterval);
      syncInterval = null;
    }
    else if (typeof interval !== 'undefined') {
      if (this.syncInterval !== null)
        clearInterval(this.syncInterval);
      
      this.syncInterval = setInterval(syncOp.bind(this), interval);
    }
  };
  
  // private functions
  function syncOp() {
    if (this.waitingForReturn || this.queue.length === 0)
      return;
    this.waitingForReturn = true;
    this.send('attempt', {'attempts': this.queue});
    this.pending.push.apply(this.pending, this.queue.splice(0, this.queue.length));
  }
  
  function prepareRecursive(stm, obj, path) {
    if (typeof path === 'undefined')
      path = [];
      
    if (isPOJS(obj)) {
      var props = Object.keys(obj);
      if (!obj.hasOwnProperty('__path')) {
        Object.defineProperties(obj, {
          '__path': {
            value: path.join("."),
          },
          '__stm': {
            value: stm
          }
        });
      }
      for (var i = 0; i < props.length; i++) {
        path.push(props[i]);
        if (props[i] != '__path' && props[i] != '__stm')
          prepareRecursive(stm, obj[props[i]], path);
        path.pop();
      }
    }
    
    return obj;
  }

  exports.STM = STM;
});
  stm = require('stm');
  })();
  if (typeof define !== 'undefined')
    define('checkerboard', stm);
  else
    window.checkerboard = stm;
}());