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
 
    this.ws.addEventListener('message', (function(event) {
      var envelope = JSON.parse(event.data);
      switch(envelope.channel) {
        case 'attempt-returned':
          for (var i = 0; i < this.pending.length; i++)
            if (envelope.message.successes.indexOf(this.pending[i].id) > -1)
              this.pending.splice(i, 1);
            
          var cur, saved = [];
          while (typeof (cur = this.queue.pop()) !== 'undefined' || typeof (cur = this.pending.pop()) !== 'undefined') {
            patch(getByPath(this.store, cur.path), reverse(cur.delta));
            saved.unshift(cur);
          }
          
          prepareRecursive(this, this.store);
                      
          for (var i = 0; i < saved.length; i++)
            this.sendAction(saved[i].path, saved[i].channel, saved[i].params);
            
          this.waitingForReturn = false;
          this.sync();
          break;
        case 'set-state':
          this.populated = true;
          this.store = prepareRecursive(this, envelope.message.data);
          var saved = this.queue.splice(0, this.queue.length);
          for (var i = 0; i < saved.length; i++)
            this.sendAction(saved[i].path, saved[i].channel, saved[i].params);
          break;
        case 'update-state':
          for (var i = 0; i < envelope.message.deltas.length; i++) {
            var observers = Object.keys(this.observers), origin = [];
            for (var j = 0; j < observers.length; j++) {
              if (getByPath(wrap(envelope.message.deltas[i].delta, envelope.message.deltas[i].path), observers[i]) !== null) {
                origin[i] = JSON.parse(JSON.stringify(getByPath(this.store, observers[i])));
              }
            }
            patch(getByPath(this.store, envelope.message.deltas[i].path), envelope.message.deltas[i].delta);
            for (var i = 0; i < origin.length; i++)
              if (typeof origin[i] !== 'undefined')
                for (var j = 0; j < this.observers[observers[i]].length; j++) {
                  this.observers[observers[i]][j].callback(getByPath(this.store, observers[i]), origin[i]);
                }
          }
          break;
      }
    }).bind(this));
  };

  STM.prototype.send = function(channel, message) {
    this.ws.send(JSON.stringify({'channel': channel, 'message': message}));
  };
  
  STM.prototype.action = function(name) {
    var action = this.actions[name] = {};
    
    return {
      onReceive: function(callback) {
        action.onReceive = callback;
      },
      onRevert: function(callback) {
        action.onRevert = callback;
      }
    };
  };
  
  STM.prototype.addObserver = function(path, callback, depth) {
    if (typeof this.observers[path] === 'undefined')
      this.observers[path] = [];
      
    this.observers[path].push({'callback': callback, 'depth': depth});
    this.send('subscribe', {'path': path, 'depth': depth});
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
    if (this.waitingForReturn || this.queue.length === 0 || !this.populated)
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