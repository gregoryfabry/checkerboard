if (typeof define !== 'function') { var define = require('amdefine')(module) }

define(['exports', 'diffpatch', 'util'], function(exports, diffpatch, util) {
  var noop = function(){};
  
  var diff = diffpatch.diff;
  var patch = diffpatch.patch;
  var isPOJS = util.isPOJS;
  var getByPath = util.getByPath;
  var wrap = util.wrap;
  var isChild = util.isChild;
    
  function STM(address) {
    var ws = new WebSocket(address);
    
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
    
    var that = this;
 
    ws.addEventListener('message', function(event) {
      var envelope = JSON.parse(event.data);
      switch(envelope.channel) {
        case 'attempt-returned':
          for (var i = 0; i < pending.length; i++)
            if (envelope.message.successes.indexOf(pending[i].id) > -1)
              pending.splice(i--, 1);
            
          var cur, saved = [];
          if (pending.length === 0) {
            waitingForReturn = false;
            sync;
            break;
          }
          
          while (typeof (cur = queue.pop()) !== 'undefined') {
            saved.unshift(cur);
            actions[cur.channel].onRevert.apply(getByPath(store, cur.path), cur.params);
          }
          while (typeof (cur = pending.pop()) !== 'undefined') {
            saved.unshift(cur);
            actions[cur.channel].onRevert.apply(getByPath(store, cur.path), cur.params);
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
            sendAction.apply({__stm: that, __path: saved[i].path}, saved[i].params);
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
      var a = actions[name] = {'onReceive': noop, 'onRevert': noop};
      
      return {
        onReceive: function(callback) {
          a.onReceive = callback;
          return this;
        },
        onRevert: function(callback) {
          a.onRevert = callback;
          return this;
        }
      };
    };
    
    var init = this.init = function(callback) {
      initFunction = callback;
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
      var params = Array.prototype.slice.call(arguments, 1)
      
      if (!initialized)
        throw new Error("action sent added before initialization");
        
      if (!(channel in actions))
        throw new Error("invalid action");
     
      var origin = getByPath(store, path); 
      if (origin === null)
        throw new Error("invalid path");
      
      var comparand = JSON.parse(JSON.stringify(origin));
      
      actions[channel].onReceive.apply(comparand, params);
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
      pending.push.apply(pending, queue.splice(0, queue.length));
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
          if (props[i] != '__path' && props[i] != '__stm')
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
      patch(getByPath(store, attempt.path), attempt.delta);
      prepareRecursive(getByPath(store, attempt.path));
      
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

  exports.STM = STM;
});