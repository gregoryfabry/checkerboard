(function() {

  var WebSocket = require('./node_modules/ws/index.js');
  var Utility = require('./lib/checkerboard.js').Utility;

  module.exports.Server = function(port, inputState) {
    var Event = new (require('events').EventEmitter)();

    if (typeof port === 'undefined')
      throw new Error('No port specified.');

    var WebSocketServer = new WebSocket.Server({'port': port});

    var State;
    if (typeof inputState !== 'undefined') {
      if (Utility.isPOJS(inputState))
        State = Utility.DiffableStateFactory(inputState);
      else
        throw new Error('Invalid state');
    }
    else
      State = Utility.DiffableStateFactory({});

    // external
    Event.state = State;
    Event.WebSocketServer = WebSocketServer;

    var conns = [];

    Event.on('open', function(conn, message) {
      do {
        conn.uuid = uuid();
      } while(conns.map(function(c) { return c !== conn ? c.uuid : undefined; }).indexOf(conn.uuid) > 0);

      conn.sendObj('data-uuid', {'uuid': conn.uuid});
    });

    Event.on('initial', function(conn, message) {
      conn.sendObj('data-set-state', {'state': conn.state(State)().merge()});
    });

    Event.on('close', function(conn) {
      conns.splice(conns.indexOf(conn), 1);
    });

    Event.on('data-attempt-state', function(conn, message) {
      var lastAttempt;
      var someFailed = message.attempts.some(function(attempt) {
        if (recursiveOneWayDiff(Utility.unStringReplace(attempt.diff), conn.state(State)().merge())) {
          lastAttempt = attempt.id;
          conn.state(State)().apply(attempt.patch);
          return false;
        }
        else
          return true;
      });
      if (typeof lastAttempt !== 'undefined') {
        conns.forEach(function(otherConn) {
          if (otherConn != conn) {
            var patch = otherConn.state(State)().patch;
            if (Object.keys(patch).length > 0)
              otherConn.sendObj('data-update-state', {'patch': patch});
          }
        });
      }
      if (!someFailed) {
        conn.sendObj('data-attempts-returned', {'lastAttempt': lastAttempt, 'patch': conn.state(State)().patch});
        State().resolve();
      }
      else {
        State().resolve();
        conn.sendObj('data-attempts-returned', {'lastAttempt': lastAttempt, 'state': conn.state(State)().merge()});
      }
    });

    WebSocketServer.on('connection', function(conn) {
      conn.sendObj = function(channel, message) {
        conn.send(JSON.stringify({'channel': channel, 'message': message}));
      };
      conns.push(conn);

      conn.state = function(baseState) {
        return baseState;
      };

      conn.refresh = function() {
        conn.sendObj('data-set-state', {'state': conn.state(State)().merge()});
      };

      Event.emit('open', conn);
      Event.emit('initial', conn);

      conn.on('message', function(json) {
        var envelope = JSON.parse(json);
        if (typeof envelope.channel !== 'undefined')
          Event.emit(envelope.channel, conn, envelope.message);
      });

      conn.on('close', function() {
        Event.emit('close', conn);
      });
    });

    return Event;
  };

  // returns true if object passes
  function recursiveOneWayDiff(left, right) {
    if (left instanceof Array)
    {
      if (!(right instanceof Array))
        return false;

      for (var i = 0; i < left.length; i++)
      {
        if (left[i] === null)
          continue;
        else if (typeof left[i] === 'undefined' && typeof right[i] === 'undefined')
          continue;
        else if (typeof left[i] !== 'undefined' && typeof right[i] === 'undefined')
          return false;
        else if (!Utility.isPOJS(left[i])) {
          if (!propDiff(left[i], right[i])) {
            return false;
          }
        }
        else if (!Utility.isPOJS(right[i]))
          return false;
        else if (!recursiveOneWayDiff(left[i], right[i]))
          return false;
      }
    }
    else
    {
      if (typeof right !== 'object')
        return false;

      for (var prop in left)
      {
        if (typeof left[prop] === 'undefined' && typeof right[prop] === 'undefined')
          continue;
        else if (!(prop in right))
          return false;
        else if (!Utility.isPOJS(left[prop])) {
          if (!propDiff(left[prop], right[prop])) {
            return false;
          }
        }
        else if (!Utility.isPOJS(right[prop]))
          return false;
        else if (!recursiveOneWayDiff(left[prop], right[prop]))
          return false;
      }
    }

    return true;
  }

  // returns true if non-obj props are equal
  function propDiff(left, right) {
    if (typeof left === 'undefined' && typeof right !== 'undefined')
      return false;
    else if (typeof left !== 'undefined' && typeof right === 'undefined')
      return false;
    else if (left === null && right === null)
      return true;
    else if (isNaN(left) && isNaN(right) && typeof left === 'number' && typeof right === 'number')
      return true;
    else if (left === right)
      return true;
    else if (left.toString() === right.toString())
        return true;

    return false;
  }

  // http://stackoverflow.com/a/2117523
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }
}());
