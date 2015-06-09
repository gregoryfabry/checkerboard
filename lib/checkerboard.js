// helper function: returns whether the supplied object is a plain ol' js object
function isPOJS(prop) {
  return !(
    prop instanceof Date ||
    prop instanceof RegExp ||
    prop instanceof String ||
    prop instanceof Number) &&
    typeof prop === 'object';
}

// the next two helper functions replace null and undefined with strings that represent that and
// vice versa. this is because nulls are used to denote no data on a diff, so if the client actually
// wishes to set a value to null they must use something else. Undefineds don't get JSON.stringify'd
// so a client setting a value to undefined would otherwise experience no result.
function unStringReplace(val) {
  if (val === '__null__')
    return null;

  if (val === '__undefined__')
    return undefined;

  return val;
}

function stringReplace(val) {
  if (val === null)
    return '__null__';

  if (typeof val === 'undefined')
    return '__undefined__';

  return val;
}

// helper function returns a representation of input data a la knockout's observables. The function
// keeps track of reads and writes to it, and provides some helper functions to merge data. It is
// used as follows:
// var ds = DiffableStateFactory(null, "root", inputData);
// ds('property'); // read a property
// ds('property', 'value') // write a property
// ds.nested('property') // read/write a nested object
// ds.array(0) // read/write an array
function DiffableStateFactory(root, prop, data) {
  root = (root === null ? DiffableStateFactory({}, null, null) : root);

  diff = (data instanceof Array ? [] : {});
  patch = (data instanceof Array ? [] : {});
  patched = false;

  // surprise! it's actually a function that we manually define properties on.
  function State(aProp, newVal) {
    if (arguments.length === 0) {
      return {
        'diff': diff,
        'patch': patch,
        'patched': patched,
        'propegateDiff': propegateDiff,
        'propegatePatch': propegatePatch,
        'branch': branch,
        'merge': merge
      };
    }

    if (arguments.length === 1) {
      if (!patched) {
        propegateDiff();
        diff[aProp] = data[aProp];
      }
      if (aProp in patch)
        return patch[aProp];
      else if (!isPOJS(data[aProp]))
        return data[aProp];
      else
        return data[aProp]().merge();
    }

    if (arguments.length === 2) {
      State[aProp] = DiffableStateFactory(State, aProp, newVal);
      State[aProp]().patched = true;
      propegatePatch();
      return (patch[aProp] = newVal);
    }
  }

  function propegateDiff() {
      if (prop !== null) {
        root().diff[prop] = diff;
        root().propegateDiff();
      }
  }

  function propegatePatch() {
    if (prop !== null) {
      root().patch[prop] = patch;
      root().propegatePatch();
    }
  }

  function branch() {
    return DiffableStateFactory(null, 'root', merge());
  }

  function itr(merge, indexOrProp) {
    if (isPOJS(data[indexOrProp]) || data[indexOrProp] instanceof Array)
      merge[indexOrProp] = State[indexOrProp]().merge();
    else if (typeof root().patch[prop] !== 'undefined' && indexOrProp in root().patch[prop])
      merge[indexOrProp] = root().patch[prop][indexOrProp];
    else
      merge[indexOrProp] = data[indexOrProp];
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
      State[index] = DiffableStateFactory(State, index, data[index]);
    });
  else if (typeof data === 'object')
    for (var _prop in data)
      if (data.hasOwnProperty(_prop))
        State[_prop] = DiffableStateFactory(State, _prop, data[_prop]);

  return State;
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
  return {'id': this.id, 'diff': this.state.$$.diff, 'patch': this.state.$$.patch};
};

// our main export. takes a WebSocket connection that it uses to sync state. provides a try function as such:
function Checkerboard(conn) {
  var state;
  var stm = this;
  var uuid;
  var attempts = [];
  var transactionId = 0;

  function sendObj(channel, message) {
    conn.send(JSON.stringify({'channel': channel, 'message': message}));
  }

  function updateState(newState) {
    var flagReady = false;
    if (typeof state === 'undefined') flagReady = true;

    state = newState;

    if (attempts.length > 0) {
      var newAttempts = [];
      newAttempts.push(new Attempt(new DiffableStateFactory(null, 'root', state), attempts[0].callback, attempts[0].deferred));
      for (var i = 1; i < attempts.length; i++)
        newAttempts.push(new Attempt(newAttempts[i - 1].state.$$.branch(), attempts[i].callback, attempts[i].deferred));
      attempts = newAttempts;
    }
    if (flagReady && 'onready' in stm && typeof stm.onready === 'function') stm.onready(new DiffableStateFactory(null, 'root', state));
    else if ('onchange' in stm && typeof stm.onchange === 'function') stm.onchange(new DiffableStateFactory(null, 'root', state));
  }

  var actionHandler = {
    'data-attempts-returned': function(message) {

      var resolvedAttempts = [];
      if (typeof message.lastAttempt !== 'undefined')
        resolvedAttempts = attempts
          .splice(0, attempts.map(function(a) { return a.id; }).indexOf(message.lastAttempt) + 1);

      updateState(message.state);

      resolvedAttempts.forEach(function(resolvedAttempt) {
        resolvedAttempt.deferred.resolve(new DiffableStateFactory(null, 'root', state));
      });

      if (intervalHandle === null)
        sync();

      waitingForReturn = false;
    },
    'data-update-state': function(message) {
      if (typeof message.uuid !== 'undefined') uuid = message.uuid;
      updateState(message.state);
    }
  };

  var savedWsHandler = conn.onmessage;
  conn.onmessage = function(json) {
    var envelope = JSON.parse(json.data);

    if (envelope.channel in actionHandler)
      actionHandler[envelope.channel](envelope.message);

    if (typeof savedWsHandler == 'function') savedWsHandler(json);
  };

  this.try = function(callback) {
    if (typeof callback !== 'function')
      return;

    var attemptState;
    if (attempts.length > 0)
      attemptState = attempts[attempts.length - 1].state.$$.branch();
    else
      attemptState = DiffableStateFactory(null, 'root', state);

    var deferred = Q.defer();
    attempts.push(new Attempt(attemptState, callback, deferred));

    return deferred.promise;
  };

  this.uuid = function() {
    return uuid;
  };

  var intervalHandle = null;
  var waitingForReturn = false;
  var sync = this.sync = function(interval) {
    if (interval === null)
      return clearInterval(intervalHandle);
    if (arguments.length > 0)
      intervalHandle = setInterval(function() { sync(); }, interval);
    if (waitingForReturn)
      return;

    var tryableAttempts = [];
    attempts.forEach(function(attempt, index) {
      var hasPatches = false;
      for (var prop in attempt.state.$$.patch) {
        hasPatches = true;
        break;
      }

      if (!hasPatches) {
        attempt.deferred.resolve(new DiffableStateFactory(null, 'root', state));
        attempts.splice(index, 1);
        return;
      }

      attempt.id = transactionId++;
      tryableAttempts.push(attempt);
    });

    if (tryableAttempts.length > 0) {
      sendObj('data-attempt-state', {'attempts': tryableAttempts});
      waitingForReturn = true;
    }
  };
}
