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
      return (State.$$.root.$$.patch[State.$$.prop] = newValorProp);
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

  State.$$.diff = {};
  State.$$.patch = {};
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

  State.$$.merge = function() {
    var merge = (State.$$.data instanceof Array ? [] : {});

    for (var _prop in State.$$.data) {
      if (typeof State.$$.root.$$.patch[prop] !== 'undefined' && _prop in State.$$.root.$$.patch[prop])
        merge[_prop] = State.$$.root.$$.patch[prop][_prop];
      else
        merge[_prop] = State.$$.data[_prop];
    }

    return merge;
  };

  if (typeof data === "object")
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

function SharedTransactionalMemory(conn) {
  var state;
  var attempts = [];
  var transactionId = 0;

  function sendObj(channel, message) {
    conn.send(JSON.stringify({'channel': channel, 'message': message}));
  }

  function updateState(newState) {
    state = newState;

    if (attempts.length === 0) return;

    var newAttempts = [];
    newAttempts.push(new Attempt(new DiffableStateFactory(null, 'root', state), attempts[0].callback, attempts[0].promise));
    for (var i = 1; i < attempts.length; i++)
      newAttempts.push(new Attempt(newAttempts[i - 1].state.$$.branch(), attempts[i].callback, attempts[i].promise));
    attempts = newAttempts;
  }

  var stm = this;
  var actionHandler = {
    'data-attempts-returned': function(message) {
      updateState(message.state);

      if (typeof message.lastAttempt !== 'undefined')
        attempts
          .splice(0, attempts.map(function(a) { return a.id; }).indexOf(message.lastAttempt))
          .forEach(function(resolvedAttempt) {
            resolvedAttempt.deferred.resolve(state);
          });
    },
    'data-update-state': function(message) {
      var flagReady = false;
      if (typeof state === 'undefined') flagReady = true;
      updateState(message.state);
      if (flagReady && 'onready' in stm && typeof stm.onready === 'function') stm.onready();
      if ('onchange' in stm && typeof stm.onchange === 'function') stm.onchange();
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
  var sync = this.sync = function(interval) {
    if (interval === null)
      return clearInterval(intervalHandle);
    if (arguments.length > 0)
      intervalHandle = setInterval(function() { sync(); }, interval);

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

    if (tryableAttempts.length > 0)
      sendObj('data-attempt-state', {'attempts': tryableAttempts});
  };
}
