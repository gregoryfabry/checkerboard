(function() {
  function Checkerboard(conn) {
    var state = this.state = new DiffableState({});
    var uuid;
    var attempts = [];
    var transactionId = 0;

    var savedWsHandler = conn.onmessage;
    conn.onmessage = function(raw) {
      var envelope = JSON.parse(raw.data);

      if (envelope.channel in actionHandler)
        actionHandler[envelope.channel](envelope.message);

      if (typeof savedWsHandler == 'function')
        savedWsHandler(raw);
    };

    var actionHandler = {
      'data-attempts-returned': function(message) {
        var i;
        for (i = 0; i < attempts.length; i++) {
          if (!(attempts[i].id <= message.lastAttempt))
            break;
          state.merge(attempts[i].patch);
          attempts[i].deferred.resolve();
        }
        attempts.splice(0, i);
        waitingForReturn = false;
      },
      'data-uuid': function(message) {
        if (typeof message.uuid !== 'undefined')
          uuid = message.uuid;
      },
      'data-update-state': function(message) {
        state.merge(message.patch);
      }
    };

    this.try = function(callback) {
      var deferred = Q.defer();
      var attempt = new Attempt(callback, deferred);
      attempts.push(attempt);
      return deferred.promise;
    };
    
    this.subscribe = function(path, callback) {
      state.subscribe(path, callback);
      this.send('data-subscribe', {'path': path});
    };

    this.uuid = function() {
      return uuid;
    };

    var send = this.send = function(channel, message) {
      conn.send(JSON.stringify({'channel': channel, 'message': message}));
    };

    var intervalHandle = null;
    var waitingForReturn = false;
    var sync = this.sync = function(interval) {
      if (interval === null) {
        clearInterval(intervalHandle);
        return;
      }
      else if (typeof interval !== 'undefined') {
        clearInterval(intervalHandle);
        intervalHandle = setInterval(function() { sync(); }, interval);
        return;
      }
      else if (waitingForReturn)
        return;

      var tryableAttempts = [];
      for (var i = 0; i < attempts.length; i++) {
        attempts[i].callback(state.proxy);
        state.update();
        attempts[i].diff = JSON.parse(JSON.stringify(state.diff));
        attempts[i].patch = JSON.parse(JSON.stringify(state.patch));
        state.reset();
        
        if (Object.keys(attempts[i].patch).length > 0) {
          attempts[i].id = transactionId++
          tryableAttempts.push(attempts[i]);
        } else {
          attempts[i].deferred.resolve();
          attempts.splice(i, 1);
        }
      }

      if (tryableAttempts.length > 0) {
        send('data-attempt-state', {'attempts': tryableAttempts});
        waitingForReturn = true;
      }
    };
  }

  // a bucket object that represents an attempt to change state. it is resolved if the attempt is successful,
  // otherwise the callback can be retried until it is.
  function Attempt(callback, deferred) {
    this.callback = callback;
    this.deferred = deferred;
  }

  Attempt.prototype.toJSON = function() {
    return {'id': this.id, 'diff': this.diff, 'patch': this.patch};
  };

  // helper function: returns whether the supplied object is a plain ol' js object
  function isPOJS(prop) {
    return !(
      prop instanceof Date ||
      prop instanceof RegExp ||
      prop instanceof String ||
      prop instanceof Number) &&
      typeof prop === 'object' &&
      prop !== null;
  }

  function DiffableStateHelper(proxy, data, diff, patch, flagSet, dsGet, dsSet) {
    this.proxy = proxy;
    this.data = data;
    this.diff = diff;
    this.patch = patch;
    this.flagSet = flagSet;
    this.dsGet = dsGet;
    this.dsSet = dsSet;
    
    this.subs = [];
  }

  DiffableStateHelper.prototype.reset = function() {
    for (var prop in this.diff)
      if (this.diff.hasOwnProperty(prop) && prop !== 'undefined')
        delete this.diff[prop];
    for (var prop in this.patch)
      if (this.patch.hasOwnProperty(prop) && prop !== 'undefined')
        delete this.patch[prop];
  }

  DiffableStateHelper.prototype.merge = function(_patch) {
    var patch = typeof _patch !== 'undefined' ? _patch : this.patch;

    for (var prop in patch) {
      if (patch.hasOwnProperty(prop) && prop !== 'toJSON') {
        var cur = patch[prop];
        if (isPOJS(cur) && '$set' in cur)
          this.data[prop] = isPOJS(cur['$set']) ? (new DiffableState(cur['$set'], {'diff': this.diff, 'patch': this.patch}, prop)) : cur['$set'];
        else if (isPOJS(cur) && this.data[prop] instanceof DiffableStateHelper)
          this.data[prop].merge(cur);
        else if (isPOJS(cur))
          this.data[prop] = new DiffableState(cur, {'diff': this.diff, 'patch': this.patch}, prop);
        else
          this.data[prop] = cur;
          
        this.proxy.__defineGetter__(prop, this.dsGet.bind(this.proxy, prop));
        this.proxy.__defineSetter__(prop, this.dsSet.bind(this.proxy, prop));
      }
      
      if (patch === this.patch)
        delete this.patch[prop];
    }
    
    if (patch === this.patch)
      for (var prop in this.diff)
        if (this.diff.hasOwnProperty(prop) && prop !== 'toJSON')
          delete this.diff[prop];
        
    var proxy = this.proxy;
    this.subs.forEach(function(sub) {
      sub(proxy, patch);
    });
  }

  DiffableStateHelper.prototype.update = function() {
    for (var prop in this.proxy) {
      if (!(prop in this.data || prop in this.patch)) {
        var tmp = this.proxy[prop];
        delete this.proxy[prop];
        this.dsSet(prop, tmp);
      }
    }
    
    for (var prop in this.data)
      if (this.data[prop] instanceof DiffableStateHelper)
        this.data[prop].update();
        
    for (var prop in this.patch)
      if (this.patch[prop] instanceof DiffableStateHelper)
        this.patch[prop].update();
  };

  DiffableStateHelper.prototype.subscribe = function(path, fn) {
    var components = typeof path === "string" ? path.split('.') : path;
    if (typeof this.data[components[0]] === 'undefined') {
      var obj = {};
      obj[components[0]] = {};
      this.merge(obj);
    }
    if (components.length === 1) {
      this.data[components[0]].subs.push(fn);
      fn(this.data[components[0]].proxy);
    }
    else
      this.data[components[0]].subscribe(components.slice(1));
  };

  DiffableStateHelper.prototype.unsubscribe = function(path, fn) {
    var components = typeof path === "string" ? path.split('.') : path;
    var dsh = (this.patch[components[0]] || this.data[components[0]]);
    if (components.length === 1)
      dsh.subs.splice(dsh.subs.indexOf(fn), 1);
    else
      dsh.subscribe(components.slice(1));
  }

  var DiffableState = Checkerboard.DiffableState = function(_data, root, rootProp, flagSet) {       
    var proxy = _data instanceof Array ? [] : {};
    proxy.toJSON = function() {
      var cpy = new proxy.constructor();
      for (var prop in proxy)
        if (proxy.hasOwnProperty(prop))
          cpy[prop] = dsGet(prop, true);
      return cpy;
    };
    
    var data = {};
    var diff = {};
    var patch = {};
    
    diff.toJSON = function() {
      var cpy = {};
        for (var prop in diff)
          if (diff.hasOwnProperty(prop) && prop !== 'toJSON')
            cpy[prop] = diff[prop];
            
      return cpy;
    };
    
    patch.toJSON = function() {
      var cpy = {};
      for (var prop in patch)
        if (patch.hasOwnProperty(prop) && prop !== 'toJSON')
          cpy[prop] = patch[prop];
          
      return cpy;
    };
    
    var dsGet = function (prop, noSides) {
      if (!(prop in diff) && !noSides && !flagSet) {
        diff[prop] = data[prop] instanceof DiffableStateHelper ? data[prop].proxy : (typeof data[prop] !== 'undefined' ? data[prop] : {'$undefined': null});
        if (typeof root !== 'undefined')
          root.diff[rootProp] = diff;
      }
      
      var toReturn = patch[prop] || data[prop];
      return toReturn instanceof DiffableStateHelper ? toReturn.proxy : isPOJS(toReturn) && '$set' in toReturn ? toReturn.$set : toReturn;
    };
      
    var dsSet = function(prop, value) {
      var c = isPOJS(value) ? (new DiffableState(value, {'diff': diff, 'patch': patch}, prop, true)) : value    
      patch.__defineGetter__(prop, function() {
        return c instanceof DiffableStateHelper ? (c.flagSet ? {'$set': c.proxy} : c.proxy) : (typeof c !== 'undefined' ? c : {'$undefined': null});
      });
      proxy.__defineGetter__(prop, dsGet.bind(proxy, prop));
      proxy.__defineSetter__(prop, dsSet.bind(proxy, prop));
      
      if (typeof root !== 'undefined')
        root.patch[rootProp] = patch;
      
      return dsGet(prop);
    };
        
    for (var prop in _data) {
      data[prop] = isPOJS(_data[prop]) ? (new DiffableState(_data[prop], {'diff': diff, 'patch': patch}, prop)) : _data[prop];
      proxy.__defineGetter__(prop, dsGet.bind(proxy, prop));
      proxy.__defineSetter__(prop, dsSet.bind(proxy, prop));
    }
      
    return new DiffableStateHelper(proxy, data, diff, patch, flagSet, dsGet, dsSet);
  };
  
  if (typeof define !== 'undefined')
    define(function() { return Checkerboard; });
  else if (typeof exports !== 'undefined')
    exports.Checkerboard = Checkerboard;
  else
    window.Checkerboard = Checkerboard;
})();