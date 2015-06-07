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
// ds.property(); // read a property
// ds.property(newValue) // write a property. Note that a new property must be defined as below
// ds('property', newValue) // write a property
// ds('newProperty', initialValue) // write a property that hasn't been defined yet
// ds.myObject.property() // read nested data - note no parens on 'intermediate' objects!
// ds.myArray[0]() // read an array value
// ds.myArray[1](newValue) // write an array value - only if it exists already! Dangerous so alt pref:
// ds.myArray(1, initialValue); // write an array value (safe)
// ds.$$.data // access raw data, without triggering a read. Useful for iterating through an array
//            // to find some items without triggering a read of the entire array.
function DiffableStateFactory(root, prop, data) {

  // surprise! it's actually a function that we manually define properties on.
  function State(newValorProp, newVal) {
    if (!State.$$.patched && arguments.length < 2) {
      State.$$.root.$$.diff[State.$$.prop] = State.$$.data;
      State.$$.root.$$.propegateDiff();
    }

    if (arguments.length === 0) {
      if (typeof State.$$.data !== 'object')
        return State.$$.data;

      return State.$$.merge();
    }

    if (arguments.length === 1) {
      State.$$.patched = true;
      State.$$.root.$$.propegatePatch();

      State.$$.root[State.$$.prop] = DiffableStateFactory(State.$$.root, State.$$.prop, newValorProp);
      State.$$.root[State.$$.prop].$$.patched = true;
      return (State.$$.root.$$.patch[State.$$.prop] = stringReplace(newValorProp));
    }

    if (arguments.length === 2) {
      if (newValorProp in State.$$.data)
        State[newValorProp](newVal);
      else {
        State.$$.data[newValorProp] = newVal;
        State[newValorProp] = DiffableStateFactory(State, newValorProp, undefined);
        State[newValorProp](newVal);
      }
    }
  }

  State.$$ = {};

  State.$$.root = (root === null ? DiffableStateFactory({}, null, null) : root);
  State.$$.prop = prop;
  State.$$.data = data;

  State.$$.diff = (State.$$.data instanceof Array ? [] : {});
  State.$$.patch = (State.$$.data instanceof Array ? [] : {});
  State.$$.patched = false;

  State.$$.propegateDiff = function() {
      if (State.$$.prop !== null) {
        State.$$.root.$$.diff[State.$$.prop] = State.$$.diff;
        State.$$.root.$$.propegateDiff();
      }
  };

  State.$$.propegatePatch = function() {
    if (State.$$.prop !== null) {
      State.$$.root.$$.patch[State.$$.prop] = State.$$.patch;
      State.$$.root.$$.propegatePatch();
    }
  };

  State.$$.branch = function() {
    return DiffableStateFactory(null, 'root', State.$$.merge());
  };

  function itr(merge, indexOrProp) {
    if (isPOJS(State.$$.data[indexOrProp]) || State.$$.data[indexOrProp] instanceof Array)
      merge[indexOrProp] = unStringReplace(State[indexOrProp].$$.merge());
    else if (typeof State.$$.root.$$.patch[prop] !== 'undefined' && indexOrProp in State.$$.root.$$.patch[prop])
      merge[indexOrProp] = unStringReplace(State.$$.root.$$.patch[prop][indexOrProp]);
    else
      merge[indexOrProp] = unStringReplace(State.$$.data[indexOrProp]);
  }

  State.$$.merge = function() {
    if (arguments.length === 0)
      stringNullUndef = false;

    var merge;

    if (State.$$.data instanceof Array) {
      merge = [];
      State.$$.data.forEach(function(a, index) {
        itr(merge, index);
      });
    }
    else {
      merge = {};
      for (var _prop in State.$$.data) {
        itr(merge, _prop);
      }
    }

    return merge;
  };

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
