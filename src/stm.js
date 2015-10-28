if (typeof define !== 'function') { var define = require('amdefine')(module) }

define('stm', ['exports', 'diffpatch'], function(exports, diffpatch) {
  var noop = function(){};
  
  var diff = diffpatch.diff;
  var patch = diffpatch.patch;
    
  function STM(ws, basePath) {
    this.ws = ws;
    this.basePath = basePath;
    this.state = {};
    this.getCallbacks = {};
    this.subCallbacks = {};
    this.attempts = [];
    this.transactionIds = [];
    this.childrenSubs = [];
    this.toSync.push(this);
    var that = this;
    this.ws.addEventListener('message', this.eventListener = function(event) {
      var envelope = JSON.parse(event.data);
      switch(envelope.channel) {
        case 'get-returned':
          if (envelope.message.id in that.getCallbacks) {
            that.getCallbacks[envelope.message.id](envelope.message.data);
            delete that.getCallbacks[envelope.message.id];
          }
          break;
        case 'attempt-returned':
          if (that.transactionIds.indexOf(envelope.message.id) < 0)
            return;
          that.transactionIds.splice(that.transactionIds.indexOf(envelope.message.id), 1);
          patch(that.state, envelope.message.delta);
          that.attempts = that.attempts.filter(function(attempt) {
            if (envelope.message.successes.indexOf(attempt.id) >= 0) {
              patch(that.state, attempt.delta);
              attempt.then(that.state);
              return false;
            } else {
              return true;
            }
          });
          that.waitingForReturn = false;
          break;
        case 'update-state':
          if (envelope.message.id in that.subCallbacks) {
            envelope.message.deltas.forEach(function(delta) {
              patch(that.state, delta);
            });
            that.subCallbacks[envelope.message.id](that.state);
          }
          break;
      }
    });
  };

  var transactionId = 0;

  STM.prototype.send = function(channel, message) {
    this.ws.send(JSON.stringify({'channel': channel, 'message': message}));
  };

  STM.prototype.get = function(path, callback) {
    if (typeof path === 'function') {
      callback = path;
      path = undefined;
    }
    
    this.getCallbacks[++transactionId] = callback;
    this.send('get', {'path': (this.basePath || '') + (typeof this.basePath === typeof path ? '.' : '') + (path || ''), 'id': transactionId});
  };

  STM.prototype.subscribe = function(path, callback, init) {
    if (typeof path === 'function') {
      callback = path;
      init = callback;
      path = undefined;
    }
    if (typeof callback === 'undefined')
      callback = noop;
    if (typeof init === 'undefined')
      init = noop;
    var toReturn = new STM(this.ws, (this.basePath || '') + (typeof this.basePath === typeof path ? '.' : '') + (path || ''));
    toReturn.subCallbacks[++transactionId] = callback;
    this.send('subscribe', {'path': toReturn.basePath, 'id': transactionId});
    toReturn.get(function(data) {
      toReturn.state = data;
      init(toReturn.state);
    });
    
    this.childrenSubs.push(toReturn);
    
    return toReturn;
  };
  
  STM.prototype.unsubscribe = function() {
    this.childrenSubs.forEach(function(sub) {
      sub.unsubscribe();
    });
    this.ws.removeEventListener('message', this.eventListener);
    this.send('unsubscribe', {'id': Object.keys(this.subCallbacks)[0]});
  };

  STM.prototype.try = function(callback, then) {
    if (typeof then === 'undefined')
      then = noop;
    this.attempts.push(new Attempt(callback, then));
    this.sync();
  };
  
  function Attempt(callback, then) {
    this.callback = callback;
    this.then = then;
  };
  
  Attempt.prototype.toJSON = function() {
    return {'id': this.id, 'delta': this.delta};
  };
  
  STM.prototype.toSync = [];
  var syncInterval = null;
  var op = function(that) {    
    that.toSync.forEach(function(toSync) {
      if (typeof toSync === 'undefined' || toSync.attempts.length === 0 || toSync.transactionIds.length > 0)
        return;
                        
      var origin = JSON.parse(JSON.stringify(toSync.state));
      var comparand = JSON.parse(JSON.stringify(toSync.state));
      var tmp = [];
      var attempts = [];
      for (var i = 0; i < toSync.attempts.length; i++)
        attempts[i] = toSync.attempts[i];

     for (var i = 0; i < attempts.length; i++) {
        attempts[i].callback(comparand);
        var a = attempts[i];
        var result = diff(origin, comparand);

        if (typeof result === 'undefined')
          a.then(comparand);
        else {
          a.delta = result;
          a.id = ++transactionId;
          patch(origin, result);
          patch(that.state, result);
          tmp.push(a);
        }
      }

      toSync.attempts = tmp;
      if (toSync.attempts.length > 0) {
        toSync.waitingForReturn = true;
        toSync.send('attempt', {id: ++transactionId, path: toSync.basePath, attempts: toSync.attempts});
        toSync.transactionIds.push(transactionId);
      }
    });
  };
  
  STM.prototype.sync = function(interval) {    
    if (typeof interval === 'undefined' && syncInterval === null)
      op(this);
    else if (typeof interval === null && syncInterval !== null) {
      clearInterval(syncInterval);
      syncInterval = null;
    }
    else if (typeof interval !== 'undefined') {
      if (syncInterval !== null)
        clearInterval(syncInterval);
      
      syncInterval = setInterval(op.bind(this, this), interval);
    }
  }

  exports.STM = STM;
});