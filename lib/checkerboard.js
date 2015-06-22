(function() {
  // our main export. takes a WebSocket connection that it uses to sync state.
  function Checkerboard(conn) {
    var trueState = DiffableStateFactory({}),
        workingState = DiffableStateFactory({});
    var flagReady = false;
    var uuid;
    var attempts = [];
    var transactionId = 0;

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
        }

        trueState().apply(message.patch);
        workingState = DiffableStateFactory(trueState().merge());

        resolvedAttempts.forEach(function(resolvedAttempt) {
          resolvedAttempt.deferred.resolve(workingState);
        });

        waitingForReturn = false;
      
        notifyChanges();
      },
      'data-uuid': function(message) {
        if (typeof message.uuid !== 'undefined')
          uuid = message.uuid;
      },
      'data-update-state': function(message) {
        trueState().apply(message.patch);
        workingState = DiffableStateFactory(trueState().merge());
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
        for (var i = 0; i < attempts.length; i++) {
          attempts[i].callback(workingState);
          attempts[i].diff = workingState().diff;
          attempts[i].patch = workingState().patch;
          workingState().resolve();

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
      attempts.push(new Attempt(callback, deferred));

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
  }

  Attempt.prototype.toJSON = function() {
    return {'id': this.id, 'diff': stringReplace(this.diff), 'patch': stringReplace(this.patch)};
  };

  // helper function returns a representation of input data a la knockout's observables. The function
  // keeps track of reads and writes to it, and provides some helper functions to merge data. It is
  // used as follows:
  // var ds = DiffableStateFactory(null, "root", inputData);
  // ds('property'); // read a property
  // ds('property', 'value') // write a property
  // ds.nested('property') // read/write a nested object
  // ds.array(0) // read/write an array
  function DiffableStateFactory(data, _prop, _root) {
    var prop, root;
    if (arguments.length === 1) {
      prop = 'root';
      root = DiffableStateFactory({}, null, null);
    }
    else {
      prop = _prop;
      root = _root;
    }

    var log = {
      'diff': undefined,
      'patch': undefined
    };

    if (data instanceof Array)
      data.forEach(function(item, index) {
        State[sanitize(index)] = DiffableStateFactory(item, index, State);
      });
    else if (isPOJS(data))
      Object.keys(data).forEach(function(p) {
        State[sanitize(p)] = DiffableStateFactory(data[p], p, State);
      });

    // surprise! it's actually a function that we manually define properties on.
    function State(key, val) {
      if (arguments.length === 0) {
        return {
          'data': data,
          'diff': log.diff,
          'patch': log.patch,
          'propegateDiff': propegateDiff,
          'propegatePatch': propegatePatch,
          'merge': merge,
          'resolve': resolve,
          'apply': apply
        };
      }

      if ((sanitize(key) in State && !State[sanitize(key)]().propegatePatch.patched) || !(sanitize(key) in State)) {
        log.diff[key] = stringReplace(data[key]);
        propegateDiff();
      }

      if (arguments.length === 1) {
        if (!(sanitize(key) in State))
          return;

        if (!isPOJS(State[sanitize(key)]().data))
          return unStringReplace(log.patch[key] || State[sanitize(key)]().data);
        else
          return State[sanitize(key)]().merge();
      }

      if (arguments.length === 2) {
        State[sanitize(key)] = DiffableStateFactory(val, key, State);
        State[sanitize(key)]().propegatePatch.patched = true;
        propegatePatch();

        if ((data[key] instanceof Array && val instanceof Array) || (isPOJS(data[key]) && isPOJS(val)))
          log.patch[key] = { '$set': stringReplace(val) };
        else
          log.patch[key] = stringReplace(val);

        return val;
      }
    }

    function propegateDiff() {
      if (typeof root === 'function' && !propegatePatch.patched) {
        root().diff[prop] = log.diff;
        root().propegateDiff();
      }
    }

    function propegatePatch() {
      if (typeof root === 'function') {
        root().patch[prop] = log.patch;
        root().propegatePatch();
      }
    }

    function merge(){
      var toReturn = data instanceof Array ? [] : {};

      for (var p in State) {
        if (!isPOJS(State[sanitize(p)]().data))
          toReturn[unsanitize(p)] = unStringReplace(log.patch[p] || State[sanitize(p)]().data);
        else
          toReturn[unsanitize(p)] = unStringReplace(State[sanitize(p)]().merge());
      }

      return toReturn;
    }

    function resolve() {
      var p;
      for (p in log.patch)
        if (!isPOJS(log.patch[p]))
          data[p] = unStringReplace(log.patch[p]);
      for (p in State)
        State[p]().resolve();

      reset();
    }

    function apply(newData) {
      for (var p in newData) {
        if (!isPOJS(newData[p]) && typeof newData[p] !== 'undefined' && newData[p] !== null)
          State(p, newData[p]);
        else if (p in State)
          State[p]().apply(newData[p]);
        else {
          State(p, newData[p] instanceof Array ? [] : {});
          State[p]().apply(newData[p]);
        }
      }
    }

    function reset() {
      log.diff = (data instanceof Array ? [] : {});
      log.patch = (data instanceof Array ? [] : {});
      propegatePatch.patched = false;
    }

    reset();
    return State;
  }

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

  // the next two helper functions replace null and undefined with strings that represent that and
  // vice versa. this is because nulls are used to denote no data on a diff, so if the client actually
  // wishes to set a value to null they must use something else. Undefineds don't get JSON.stringify'd
  // so a client setting a value to undefined would otherwise experience no result.
  function stringReplace(obj) {
    if (obj === null)
      return '__null__';
    else if (typeof obj === 'undefined')
      return '__undefined__';
    else if (isPOJS(obj))
      for (var p in obj)
        obj[p] = stringReplace(obj[p]);

    return obj;
  }

  function unStringReplace(obj) {
    if (obj === '__null__')
      return null;
    else if (obj === '__undefined__')
      return undefined;
    else if (isPOJS(obj))
      for (var p in obj)
        obj[p] = unStringReplace(obj[p]);

    return obj;
  }

  function sanitize(prop) {
    return (prop in Function.prototype ? '_' + prop : prop);
  }

  function unsanitize(prop) {
    if (prop[0] !== '_')
      return prop;

    var substr = prop.substring(1, prop.length);
    return (substr in Function.prototype ? substr : prop);
  }


  if (typeof exports !== 'undefined') {
    exports.Checkerboard = Checkerboard;
    exports.Utility = {
      'DiffableStateFactory': DiffableStateFactory,
      'isPOJS': isPOJS,
      'stringReplace': stringReplace,
      'unStringReplace': unStringReplace,
      'sanitize': sanitize,
      'unsanitize': unsanitize
    };
  }
  else {
      window.Checkerboard = Checkerboard;
      window.DSF = DiffableStateFactory;
  }

}());
