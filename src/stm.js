if (typeof define !== 'function') { var define = require('amdefine')(module) }

define(['exports', 'diffpatch', 'util'], function(exports, diffpatch, util) {
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

      if (applyQuick(actions[channel].onReceive, comparand, params) === false)
        return;

      var delta = diff(origin, comparand);

      if (typeof delta === 'undefined')
        return;

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
        var props = Object.keys(obj);
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
        for (var i = 0; i < props.length; i++) {
          path.push(props[i]);
          if (props[i] != '__path' && props[i] != '__stm' && props[i] != 'addObserver' && props[i] != 'sendAction')
            prepareRecursive(obj[props[i]], path);
          path.pop();
        }
      }

      return obj;
    }

    function patchAndNotify(attempt) {
      var observerPaths = Object.keys(observers), origin = [];
      for (var j = 0; j < observerPaths.length; j++)
        if (getByPath(wrap(attempt.delta, attempt.path), observerPaths[j]) !== null) {
          var maybeOrigin = getByPath(store, observerPaths[j]);
          if (isPOJS(maybeOrigin))
            origin[j] = JSON.parse(JSON.stringify(maybeOrigin));
        }
      patch(getByPath(store, attempt.path), attempt.delta, true);
      prepareRecursive(getByPath(store, attempt.path), attempt.path !== '' ? attempt.path.split('.') : undefined);

      for (var i = 0; i < origin.length; i++)
        if (typeof origin[i] !== 'undefined')
          for (var j = 0; j < observers[observerPaths[i]].length; j++)
            observers[observerPaths[i]][j].callback(getByPath(store, observerPaths[i]), origin[i]);
    }
  }

  function Attempt(params) {
    var props = Object.keys(params);
    for (var i = 0; i < props.length; i++)
      this[props[i]] = params[props[i]];
  };

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
