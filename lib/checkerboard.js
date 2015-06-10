(function() {
  // our main export. takes a WebSocket connection that it uses to sync state.
  function Checkerboard(conn) {
    var state = {};
    var stm = this;
    var uuid;
    var attempts = [];
    var transactionId = 0;

    var savedWsHandler = conn.onmessage;
    conn.onmessage = function(json) {
      var envelope = JSON.parse(json.data);

      if (envelope.channel in actionHandler)
        actionHandler[envelope.channel](envelope.message);

      if (typeof savedWsHandler == 'function') savedWsHandler(json);
    };

    var actionHandler = {
      'data-attempts-returned': function(message) {

        var resolvedAttempts = [];
        if (typeof message.lastAttempt !== 'undefined')
          resolvedAttempts = attempts
            .splice(0, attempts.map(function(a) { return a.id; }).indexOf(message.lastAttempt) + 1);

        updateState(message.patch);

        resolvedAttempts.forEach(function(resolvedAttempt) {
          resolvedAttempt.deferred.resolve(DiffableStateFactory(state));
        });

        waitingForReturn = false;

        //if (intervalHandle === null)
        //  this.sync();
      },
      'data-uuid': function(message) {
        if (typeof message.uuid !== 'undefined') uuid = message.uuid;
      },
      'data-update-state': function(message) {
        updateState(message.patch);
      }
    };

    function updateState(patch) {
      var flagReady = false;
      if (typeof state === 'undefined') flagReady = true;

      assign(unStringReplace(patch), state);

      if (attempts.length > 0) {
        var newAttempts = [];
        newAttempts.push(new Attempt(DiffableStateFactory(state), attempts[0].callback, attempts[0].deferred));
        for (var i = 1; i < attempts.length; i++)
          newAttempts.push(new Attempt(newAttempts[i - 1].state().branch(), attempts[i].callback, attempts[i].deferred));
        attempts = newAttempts;
      }
      if (flagReady && 'onready' in stm && typeof stm.onready === 'function') stm.onready(DiffableStateFactory(state));
      else if ('onchange' in stm && typeof stm.onchange === 'function') stm.onchange(DiffableStateFactory(state));
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
        return (intervalHandle = setInterval(function() { this.sync(); }, interval));

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
  function DiffableStateFactory(data, prop, root) {
    if (arguments.length === 1) {
      prop = 'root';
      root = DiffableStateFactory({}, null, null);
    }

    var diff = (data instanceof Array ? [] : {});
    var patch = (data instanceof Array ? [] : {});
    var patched = false;

    // surprise! it's actually a function that we manually define properties on.
    function State(_prop, val) {
      if (arguments.length === 0) {
        return {
          'data': data,
          'diff': diff,
          'patch': patch,
          'patched': patched,
          'propegateDiff': propegateDiff,
          'propegatePatch': propegatePatch,
          'branch': branch,
          'merge': merge
        };
      }
      if (!patched) {
        diff[_prop] = data[_prop];
        propegateDiff();
      }

      if (arguments.length === 1) {
        if (!(sanitize(_prop) in State))
          return;
        else if (!isPOJS(State[sanitize(_prop)]().data))
          return patch[_prop] || State[sanitize(_prop)]().data;
        else
          return State[sanitize(_prop)]().merge();
      }

      if (arguments.length === 2) {
        State[sanitize(_prop)] = DiffableStateFactory(val, _prop, State);

        State[sanitize(_prop)]().patched = true;
        propegatePatch();

        if (isPOJS(data[_prop]))
          patch[_prop] = { '$set': val };
        else
          patch[_prop] = val;

        return val;
      }
    }

    function propegateDiff() {
      if (typeof root === 'function') {
        root().diff[prop] = diff;
        root().propegateDiff();
      }
    }

    function propegatePatch() {
      if (typeof root === 'function') {
        root().patch[prop] = patch;
        root().propegatePatch();
      }
    }

    function branch() {
      return DiffableStateFactory(merge());
    }

    function itr(merge, _prop) {
      if (isPOJS(data[_prop]) || data[_prop] instanceof Array)
        merge[_prop] = State[sanitize(_prop)]().merge();
      else if (typeof root().patch[prop] !== 'undefined' && _prop in root().patch[prop])
        merge[_prop] = root().patch[prop][_prop];
      else
        merge[_prop] = data[_prop];

      if (isPOJS(merge[_prop]) && '$set' in merge[_prop])
        merge[_prop] = merge[_prop].$set;
    }

    function merge(){
      if (arguments.length === 0)
        stringNullUndef = false;

      var toReturn;

      if (data instanceof Array) {
        toReturn = [];
        data.forEach(function(a, index) {
          itr(toReturn, index);
        });
      }
      else {
        toReturn = {};
        for (var _prop in data) {
          itr(toReturn, _prop);
        }
      }

      return toReturn;
    }

    if (data instanceof Array)
      data.forEach(function(item, index) {
        State[sanitize(index)] = DiffableStateFactory(item, index, State);
      });
    else if (typeof data === 'object')
      for (var _prop in data)
        if (data.hasOwnProperty(_prop))
          State[sanitize(_prop)] = DiffableStateFactory(data[_prop], _prop, State);

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
    if (!isPOJS(obj)) {
      if (obj === null)
        return '__null__';
      else if (typeof obj === 'undefined')
        return '__undefined__';
      else
        return obj;
    }

    if (obj instanceof Array)
      obj = obj.map(function(item) {
        return stringReplace(item);
      });
    else
      for (var prop in obj)
        obj[prop] = stringReplace(obj[prop]);

    return obj;
  }

  function unStringReplace(obj) {
    if (!isPOJS(obj)) {
      if (obj === '__null__')
        return null;
      else if (obj === '__undefined__')
        return undefined;
      else
        return obj;
    }

    if (obj instanceof Array)
      obj = obj.map(function(item) {
        return unStringReplace(item);
      });
    else
      for (var prop in obj)
        obj[prop] = unStringReplace(obj[prop]);

    return obj;
  }

  // recursively assigns left to right
  function assign(left, right, keepMods) {
    if (left instanceof Array)
      left.forEach(function(item, index) {
        assignHelper(left, right, index, keepMods);
      });
    else {
      for (var prop in left) {
        assignHelper(left, right, prop, keepMods);
      }
    }
    return right;
  }

  function assignHelper(left, right, prop, keepMods) {
    if (left[prop] instanceof Array) {
      if (right[prop] instanceof Array)
        assign(left[prop], right[prop]);
      else
        assign(left[prop], right[prop] = []);
    }
    else if (isPOJS(left[prop])) {
      if ('$set' in left[prop] && !keepMods)
        right[prop] = left[prop].$set;
      else if (isPOJS(right[prop]))
        assign(left[prop], right[prop]);
      else
        assign(left[prop], right[prop] = {});
    }
    else if (left[prop] !== null && typeof left[prop] !== 'undefined') {
      right[prop] = left[prop];
    }
  }

  function sanitize(prop) {
    return (prop in Function.prototype ? '_' + prop : prop);
  }

  if (typeof exports !== 'undefined') {
    exports.Checkerboard = Checkerboard;
    exports.Utility = {
      'isPOJS': isPOJS,
      'stringReplace': stringReplace,
      'unStringReplace': unStringReplace,
      'assign': assign,
      'sanitize': sanitize
    };
  }
  else if (typeof define === 'function' && define.amd) {
    define(function() {
      return Checkerboard;
    });
  }
  else {
      window.Checkerboard = Checkerboard;
  }

}());
