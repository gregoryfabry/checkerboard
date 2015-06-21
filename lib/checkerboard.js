(function() {
  // our main export. takes a WebSocket connection that it uses to sync state.
  function Checkerboard(conn) {
    var state = {};
    var flagReady = false;
    var stm = this;
    var uuid;
    var attempts = [];
    var transactionId = 0;

    var savedWsHandler = conn.onmessage;
    conn.onmessage = function(json) {
      var envelope = JSON.parse(json.data);

      if (envelope.channel in actionHandler)
        actionHandler[envelope.channel](envelope.message);

      emit(envelope.channel, envelope.message);

      if (typeof savedWsHandler == 'function') savedWsHandler(json);
    };

    var actionHandler = {
      'data-attempts-returned': function(message) {

        var resolvedAttempts = [];
        if (typeof message.lastAttempt !== 'undefined')
          resolvedAttempts = attempts
            .splice(0, attempts.map(function(a) { return a.id; }).indexOf(message.lastAttempt) + 1);

        state = assign(message.patch, state);
        reattempt();

        resolvedAttempts.forEach(function(resolvedAttempt) {
          resolvedAttempt.deferred.resolve(DiffableStateFactory(state));
        });

        waitingForReturn = false;
      },
      'data-uuid': function(message) {
        if (typeof message.uuid !== 'undefined') uuid = message.uuid;
      },
      'data-update-state': function(message) {
        assign(unStringReplace(message.patch), state);
        reattempt();
      },
      'data-overwrite-state': function(message) {
        state = unStringReplace(message.state);
        reattempt();
      }
    };

    function reattempt() {
      if (attempts.length > 0) {
        var newAttempts = [];
        newAttempts.push(new Attempt(DiffableStateFactory(state), attempts[0].callback, attempts[0].deferred));
        for (var i = 1; i < attempts.length; i++)
          newAttempts.push(new Attempt(newAttempts[i - 1].state().branch(), attempts[i].callback, attempts[i].deferred));
        attempts = newAttempts;
      }

      if (!flagReady) {
        flagReady = true;
        emit('ready', DiffableStateFactory(state));
      }
      else
        emit('change', DiffableStateFactory(state));
    }

    this.try = function(callback) {
      if (typeof callback !== 'function')
        return;

      var attemptState;
      if (attempts.length > 0)
        attemptState = attempts[attempts.length - 1].state().branch();
      else
        attemptState = DiffableStateFactory(state);

      var deferred = Q.defer();
      attempts.push(new Attempt(attemptState, callback, deferred));

      return deferred.promise;
    };

    this.uuid = function() {
      return uuid;
    };

    this.send = function(channel, message) {
      conn.send(JSON.stringify({'channel': channel, 'message': message}));
    };

    var intervalHandle = null;
    var waitingForReturn = false;
    this.sync = function(interval) {
      if (interval === null)
        return clearInterval(intervalHandle);
      else if (waitingForReturn)
        return;
      else if (arguments.length > 0)
        return (intervalHandle = setInterval(function() { stm.sync(); }, interval));

      var tryableAttempts = [];
      attempts.forEach(function(attempt, index) {
        var hasPatches = false;
        for (var prop in attempt.state().patch) {
          hasPatches = true;
          break;
        }

        if (!hasPatches) {
          attempt.deferred.resolve(DiffableStateFactory(state));
          attempts.splice(index, 1);
          return;
        }

        attempt.id = transactionId++;
        tryableAttempts.push(attempt);
      });

      if (tryableAttempts.length > 0) {
        this.send('data-attempt-state', {'attempts': tryableAttempts});
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
  function Attempt(state, callback, deferred) {
    this.state = state;
    this.callback = callback;
    this.deferred = deferred;

    callback(state);
  }

  Attempt.prototype.toJSON = function() {
    return {'id': this.id, 'diff': stringReplace(this.state().diff), 'patch': stringReplace(this.state().patch)};
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
    }

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
          return unStringReplace(State[sanitize(key)]().merge());
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
      for (var p in State)
        toReturn[p] = State(p);
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

  // recursively assigns left to right
  function assign(left, right, keepMods) {
      if (left instanceof Array) {
        if (!(right instanceof Array))
          console.log('errrr');
        left.forEach(function(_, prop) {
          assignHelper(left, right, prop, keepMods);
        });
      }
      else {
        for (var prop in left) {
          if (!isPOJS(right))
            console.log('errrr');
          assignHelper(left, right, prop, keepMods);
        }
      }
      return right;
    }

    function assignHelper(left, right, prop, keepMods) {
      if (isPOJS(left[prop]) && '$set' in left[prop] && !keepMods) {
        if (right[prop] instanceof Array)
          right[prop].splice(0, right[prop].length);
        else
          for (var p in right[prop])
            delete right[prop][p];
        right[prop] = assign(left[prop].$set, right[prop], keepMods);
      }
      else if (left[prop] instanceof Array && right[prop] instanceof Array)
        right[prop] = assign(left[prop], right[prop], keepMods);
      else if (isPOJS(left[prop]) && isPOJS(right[prop]))
        right[prop] = assign(left[prop], right[prop], keepMods);
      else if (isPOJS(left[prop]))
        right[prop] = assign(left[prop], right[prop] = left[prop] instanceof Array ? [] : {}, keepMods);
      else if (left[prop] !== null)
        right[prop] = left[prop];
    }

  function sanitize(prop) {
    return (prop in Function.prototype ? '_' + prop : prop);
  }

  if (typeof exports !== 'undefined') {
    exports.Checkerboard = Checkerboard;
    exports.Utility = {
      'DiffableStateFactory': DiffableStateFactory,
      'isPOJS': isPOJS,
      'stringReplace': stringReplace,
      'unStringReplace': unStringReplace,
      'assign': assign,
      'sanitize': sanitize
    };
  }
  else {
      window.Checkerboard = Checkerboard;
      window.DSF = DiffableStateFactory;
  }

}());
