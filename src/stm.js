if (typeof define !== 'function') { var define = require('amdefine')(module) }

define(['exports', 'diffpatch', 'util'], function(exports, diffpatch, util) {
  var noop = function(){};
  
  var diff = diffpatch.diff;
  var patch = diffpatch.patch;
  var reverse = diffpatch.reverse;
  var isPOJS = util.isPOJS;
  var getByPath = util.getByPath;
  var wrap = util.wrap;
  var isChild = util.isChild;
  
  Object.prototype.addObserver = function(callback, depth) {
    if (!('__stm' in this))
      throw new Error('addObserver called on unprepared object');
    this.__stm.addObserver(this.__path, callback, depth);
  };
  
  Object.prototype.sendAction = function(channel) {
    console.time('sendAction');
    if (!('__stm' in this))
      throw new Error('sendAction called on unprepared object');
    this.__stm.sendAction(this.__path, channel, Array.prototype.slice.call(arguments, 1));
    console.timeEnd('sendAction');
  }
    
  function STM(address) {
    this.ws = new WebSocket(address);
    
    this.actions = {};
    this.store = prepareRecursive(this, {});
    this.observers = {};
    
    this.attemptID = 0;
    this.updateID = null;
    this.syncInterval = null;
    
    this.pending = [];
    this.queue = [];
    
    this.initialized = false;
    this.initFunction = function(){};
    this.waitingForReturn = false;
 
    this.ws.addEventListener('message', (function(event) {
      var envelope = JSON.parse(event.data);
      switch(envelope.channel) {
        case 'attempt-returned':
          console.time('attempt-returned');
          for (var i = 0; i < this.pending.length; i++)
            if (envelope.message.successes.indexOf(this.pending[i].id) > -1)
              this.pending.splice(i--, 1);
            
          var cur, saved = [];
          while (typeof (cur = this.queue.pop()) !== 'undefined') {
            saved.unshift(cur);
            this.actions[cur.channel].onRevert.apply(getByPath(this.store, cur.path), cur.params);
          }
          while (typeof (cur = this.pending.pop()) !== 'undefined') {
            saved.unshift(cur);
            this.actions[cur.channel].onRevert.apply(getByPath(this.store, cur.path), cur.params);
          }
   
          for (var p in envelope.message.fixes) {
            if (!envelope.message.fixes.hasOwnProperty(p))
              continue;
            if (p === '')
              this.store = envelope.message.fixes[p];
            else {
              var components = p.split('.');
              var root = getByPath(this.store, components.slice(0, components.length - 1).join('.'));
              root[components[components.length - 1]] = envelope.message.fixes[p]
            }
          }
           
          prepareRecursive(this, this.store);
                      
          for (var i = 0; i < saved.length; i++)
            this.sendAction(saved[i].path, saved[i].channel, saved[i].params);
            
          this.waitingForReturn = false;
          this.sync();
          console.timeEnd('attempt-returned');
          break;
        case 'set-state':
          this.store = prepareRecursive(this, envelope.message.data);
          this.initialized = true;
          this.initFunction(this.store);
          break;
        case 'update-state':
          console.time('update-state');
          for (var i = 0; i < envelope.message.deltas.length; i++)
            patchAndNotify(envelope.message.deltas[i], this.store, this.observers, this);
          console.timeEnd('update-state');
          break;
      }
    }).bind(this));
  };
  
  STM.prototype.action = function(name) {
    var action = this.actions[name] = {'onReceive': noop, 'onRevert': noop};
    
    return {
      onReceive: function(callback) {
        action.onReceive = callback;
        return this;
      },
      onRevert: function(callback) {
        action.onRevert = callback;
        return this;
      }
    };
  };
  
  STM.prototype.init = function(callback) {
    this.initFunction = callback;
  };
  
  STM.prototype.addObserver = function(path, callback, depth) {
    if (!this.initialized)
      throw new Error("observer added before initialization");
    if (typeof this.observers[path] === 'undefined')
      this.observers[path] = [];
      
    this.observers[path].push({'callback': callback, 'depth': depth});
    this.send('subscribe', {'path': path, 'depth': depth});
  }
  
  STM.prototype.sendAction = function(path, channel, params) {
    if (!this.initialized)
      throw new Error("action sent added before initialization");
      
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
    
    var attempt = new Attempt({'id': this.attemptID++, 'path': path, 'channel': channel, 'params': params, 'delta': delta});
    patchAndNotify(attempt, this.store, this.observers, this);
    
    this.queue.push(attempt);
    this.sync();
  };
  
  STM.prototype.send = function(channel, message) {
    this.ws.send(JSON.stringify({'channel': channel, 'message': message}));
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
  
  function Attempt(params) {
    var props = Object.keys(params);
    for (var i = 0; i < props.length; i++)
      this[props[i]] = params[props[i]];
  };
  
  Attempt.prototype.toJSON = function() {
    return {'id': this.id, 'path': this.path, 'delta': this.delta};
  };
  
  // private functions
  function syncOp() {
    if (this.waitingForReturn || this.queue.length === 0 || !this.initialized)
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
  
  function patchAndNotify(attempt, store, observers, stm) {
    var observerPaths = Object.keys(observers), origin = [];
    for (var j = 0; j < observerPaths.length; j++)
      if (getByPath(wrap(attempt.delta, attempt.path), observerPaths[j]) !== null) {
        var maybeOrigin = getByPath(store, observerPaths[j]);
        if (isPOJS(maybeOrigin))
          origin[j] = JSON.parse(JSON.stringify(maybeOrigin));
      }
    patch(getByPath(store, attempt.path), attempt.delta);
    prepareRecursive(stm, getByPath(store, attempt.path));
    
    for (var i = 0; i < origin.length; i++)
      if (typeof origin[i] !== 'undefined')
        for (var j = 0; j < observers[observerPaths[i]].length; j++)
          observers[observerPaths[i]][j].callback(getByPath(store, observerPaths[i]), origin[i]);
  }

  exports.STM = STM;
});