var WebSocket = require('ws');
//var Datastore = require('nedb');
Object.assign = require('object-assign');

var WebSocketServer = new WebSocket.Server({'port': 904});
var State = {};

// returns true if object passes
function recursiveOneWayDiff(left, right) {
  for (var prop in left)
  {
    if (!(prop in right))
      return false;
    else if (!isPOJS(left[prop])) {
      if (!propDiff(left[prop], right[prop])) {
        return false;
      }
    }
    else if (!isPOJS(right[prop]))
      return false;
    else if (!recursiveOneWayDiff(left[prop], right[prop]))
      return false;
  }

  return true;
}

function isPOJS(prop) {
  return !(
    prop instanceof Date ||
    prop instanceof RegExp ||
    prop instanceof String ||
    prop instanceof Number) &&
    typeof prop === 'object';
}

// returns true if non-obj props are equal
function propDiff(left, right) {
  if (isNaN(left) && isNaN(right) && typeof left === 'number' && typeof right === 'number')
    return true;
  else if (left === right)
    return true;
  else if (left.toString() === right.toString())
      return true;

  return false;
}

var messageHandler = {
  'event-open': function(conn, message) {
    conn.sendObj('data-update-state', {'state': State});
  },
  'data-attempt-state': function(conn, message) {
    var lastAttempt;
    message.attempts.some(function(attempt) {
      if (recursiveOneWayDiff(attempt.diff, State)) {
        lastAttempt = attempt.id;
        Object.assign(State, attempt.patch);
        return false;
      }
      else
        return true;
    });
    if (typeof lastAttempt !== 'undefined')
      conns.forEach(function(otherConn) {
        if (otherConn != conn)
          otherConn.sendObj('data-update-state', {'state': State});
      });
    conn.sendObj('data-attempts-returned', {'lastAttempt': lastAttempt, 'state': State});
  }
};

var conns = [];
var id = 0;
WebSocketServer.on('connection', function(conn) {
  conn.id = id++;
  conn.sendObj = function(channel, message) {
    conn.send(JSON.stringify({'channel': channel, 'message': message}));
  };
  conns.push(conn);

  conn.on('message', function(json) {
    var envelope = JSON.parse(json);
    if (envelope.channel in messageHandler)
      messageHandler[envelope.channel](conn, envelope.message);
  });

  conn.on('close', function() {
    conns.splice(conns.map(function(conn) { return conn.id; }).indexOf(conn.id), 1);
  });

  conn.sendObj('data-update-state', {'state': State});

});
