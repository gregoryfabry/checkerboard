(function() {
  function Checkerboard(conn) {
    var state = DiffableStateFactory({});
    var flagReady = false;
    var uuid;
    var attempts = [];
    var transactionId = 0;
    var undo = [];

    this.state = function() {
      return workingState;//.apply(this, [].slice.call(arguments));
    };

    var savedWsHandler = conn.onmessage;
    conn.onmessage = function(json) {
      var envelope = JSON.parse(json.data);

      if (envelope.channel in actionHandler)
        actionHandler[envelope.channel](envelope.message);

      emit(envelope.channel, envelope.message);

      if (typeof savedWsHandler == 'function')
        savedWsHandler(json);
    };

    var actionHandler = {
      'data-attempts-returned': function(message) {

        var resolvedAttempts = [];
        if (typeof message.lastAttempt !== 'undefined') {
          var index = attempts.map(function(a) { return a.id; }).indexOf(message.lastAttempt) + 1;
          resolvedAttempts = attempts.splice(0, index);

          trueState().apply(message.patch);
          while (undo.length > 0)
            workingState().apply(undo.pop());

          workingState().resolve();
          workingState().apply(message.patch);
          workingState().resolve();

          resolvedAttempts.forEach(function(resolvedAttempt) {
            resolvedAttempt.deferred.resolve(workingState);
          });

        }
        else {
          trueState = DiffableStateFactory(message.state);
          workingState = DiffableStateFactory(message.state);
          undo = [];
        }

        attempts.forEach(function(attempt) {
          attempt.tried = false;
        });

        waitingForReturn = false;

        emit('attempt', workingState);
      },
      'data-uuid': function(message) {
        if (typeof message.uuid !== 'undefined')
          uuid = message.uuid;
      },
      'data-update-state': function(message) {
        trueState().apply(message.patch);
        while (undo.length > 0)
          workingState().apply(undo.pop());
        workingState().resolve();
        workingState().apply(message.patch);
        workingState().resolve();

        notifyChanges();
      },
      'data-set-state': function(message) {
        trueState = DiffableStateFactory(message.state);
        workingState = DiffableStateFactory(message.state);
        notifyChanges();
      }
    };

    function reattempt() {
      var tryableAttempts = [];

      if (attempts.length > 0) {
        while (undo.length > 0)
          workingState().apply(undo.pop());
        workingState().resolve();

        for (var i = 0; i < attempts.length; i++) {
          if (!attempts[i].tried) {
            attempts[i].callback(workingState);
            attempts[i].diff = workingState().diff;
            undo.push(workingState().diff);
            attempts[i].patch = workingState().patch;
            workingState().resolve();
          }
          else
            undo.push(attempts[i].diff);

          if (Object.keys(attempts[i].patch).length > 0) {
            attempts[i].id = transactionId++;
            tryableAttempts.push(attempts[i]);
          }
          else {
            attempts[i].deferred.resolve(workingState);
            attempts.splice(i, 1);
          }
        }
      }
      return tryableAttempts;
    }

    function notifyChanges() {
      if (!flagReady) {
        flagReady = true;
        emit('ready', workingState);
      }
      else
        emit('change', workingState);
    }

    this.try = function(callback) {
      if (typeof callback !== 'function')
        return;

      var deferred = Q.defer();

      var attempt = new Attempt(callback, deferred);
      callback(workingState);
      attempt.diff = workingState().diff;
      undo.push(workingState().diff);
      attempt.patch = workingState().patch;
      workingState().resolve();

      attempts.push(attempt);

      return deferred.promise;
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

      var tryableAttempts = reattempt();

      if (tryableAttempts.length > 0) {
        send('data-attempt-state', {'attempts': tryableAttempts});
        waitingForReturn = true;
      }
    };

    var events = {
      'change': [],
      'ready': [],
      'message': []
    };

    this.on = function(event, callback) {
      if (event in events && typeof callback === 'function')
        events[event].push(callback);
      else if (typeof callback === 'function')
        events[event] = [callback];
    };

    this.removeListener = function(event, callback) {
      if (event in events) {
        var index = events[event].indexOf(callback);
        if (index !== -1)
          events[event].splice(index, 1);
      }
    };

    function emit(event) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (event in events)
        events[event].forEach(function(f) {
          f.apply(this, args);
        });
    }
  }

  // a bucket object that represents an attempt to change state. it is resolved if the attempt is successful,
  // otherwise the callback can be retried until it is.
  function Attempt(callback, deferred) {
    this.callback = callback;
    this.deferred = deferred;
    this.tried = true;
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
  
  function DiffableStateHelper(ds, data, diff, patch, dsGet, dsSet) {
    this.ds = ds;
    this.data = data;
    this.diff = diff;
    this.patch = patch;
    this.dsGet = dsGet;
    this.dsSet = dsSet;
  }
  
  DiffableStateHelper.prototype.merge = function(_patch) {
    var patch = typeof _patch !== 'undefined' ? _patch : this.patch;
      
  }
  
  DiffableStateHelper.prototype.update = function() {
    for (var prop in this.ds) {
      if (!(prop in this.data || prop in this.patch)) {
        var tmp = this.ds[prop];
        delete this.ds[prop];
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
  
  function DiffableState(_data, root, rootProp) {       
    var proxy = _data instanceof Array ? [] : {};
    
    var data = new proxy.constructor();
    var diff = new proxy.constructor();
    var patch = new proxy.constructor();
    
    var dsGet = function (prop) {
      if (!(prop in diff)) {
        diff[prop] = data[prop] instanceof DiffableStateHelper ? data[prop].ds : data[prop];
        if (typeof root !== 'undefined')
          root.diff[rootProp] = diff;
      }
      
      var toReturn = patch[prop] || data[prop];
      return toReturn instanceof DiffableStateHelper ? toReturn.ds : toReturn;
    };
      
    var dsSet = function(prop, value) {
      patch[prop] = isPOJS(value) ? (new DiffableState(value, {'diff': diff, 'patch': patch}, prop)) : value    
      
      if (typeof root !== 'undefined')
        root.patch[rootProp] = patch;
      
      return dsGet(prop);
    };
        
    for (var prop in _data) {
      data[prop] = isPOJS(_data[prop]) ? (new DiffableState(_data[prop], {'diff': diff, 'patch': patch}, prop)) : _data[prop];
      proxy.__defineGetter__(prop, dsGet.bind(proxy, prop));
      proxy.__defineSetter__(prop, dsSet.bind(proxy, prop));
    }
      
    return new DiffableStateHelper(proxy, data, diff, patch, dsGet, dsSet);
  };
}());
