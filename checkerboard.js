function isPOJS(prop) {
  return !(
    prop instanceof Date ||
    prop instanceof RegExp ||
    prop instanceof String ||
    prop instanceof Number) &&
    typeof prop === 'object';
}

function unStringReplace(val) {
  if (val === '$$null$$')
    return null;

  if (val === '$$undefined$$')
    return undefined;

  return val;
}

function stringReplace(val) {
  if (val === null)
    return '$$null$$';

  if (typeof val === 'undefined')
    return '$$undefined$$';

  return val;
}

function DiffableStateFactory(root, prop, data) {

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
      merge[indexOrProp] = State[indexOrProp].$$.merge();
    else if (typeof State.$$.root.$$.patch[prop] !== 'undefined' && indexOrProp in State.$$.root.$$.patch[prop])
      merge[indexOrProp] = State.$$.root.$$.patch[prop][indexOrProp];
    else
      merge[indexOrProp] = State.$$.data[indexOrProp];

    if (merge[indexOrProp] === '$$null$$')
      merge[indexOrProp] = null;
    else if (merge[indexOrProp] === '$$undefined$$')
      merge[indexOrProp] = undefined;
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

function Attempt(state, callback, deferred) {
  this.state = state;
  this.callback = callback;
  this.deferred = deferred;
  try {
    callback(state);
  } catch (err) {
    throw err;
  }
}

Attempt.prototype.toJSON = function() {
  return {'id': this.id, 'diff': this.state.$$.diff, 'patch': this.state.$$.patch};
};

function SharedTransactionalMemory(conn, optionalState) {
  var state = optionalState;
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
    if (flagReady && 'onready' in stm && typeof stm.onready === 'function') stm.onready();
    if ('onchange' in stm && typeof stm.onchange === 'function') stm.onchange(newState);
  }

  var stm = this;
  var actionHandler = {
    'data-attempts-returned': function(message) {

      var resolvedAttempts = [];
      if (typeof message.lastAttempt !== 'undefined')
        resolvedAttempts = attempts
          .splice(0, attempts.map(function(a) { return a.id; }).indexOf(message.lastAttempt) + 1);

      updateState(message.state);

      resolvedAttempts.forEach(function(resolvedAttempt) {
        resolvedAttempt.deferred.resolve(state);
      });

      waitingForReturn = false;
    },
    'data-update-state': function(message) {
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
        attempt.deferred.resolve(state);
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
