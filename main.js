(function() {

  var WebSocket = require('ws');
  var Utility = require('./lib/checkerboard.js').Utility;

  module.exports.Server = function(port, inputState) {
    if (typeof port === 'undefined')
      throw new Error('No port specified.');

    var WebSocketServer = new WebSocket.Server({'port': port});

    var State = {};
    if (typeof inputState !== 'undefined') {
      if (Utility.isPOJS(inputState))
        State = inputState;
      else
        throw new Error('Invalid state');
    }

    // external
    this.state = State;
    this.WebSocketServer = WebSocketServer;

    var conns = [];
    var id = 0;

    var messageHandler = {
      'event-open': function(conn, message) {
        // http://stackoverflow.com/a/2117523
        conn.uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
          return v.toString(16);
        });

        conn.sendObj('data-uuid', {'uuid': conn.uuid});
        conn.sendObj('data-update-state', {'patch': State});
      },
      'data-attempt-state': function(conn, message) {
        var lastAttempt;
        var patch = {};
        message.attempts.some(function(attempt) {
          if (recursiveOneWayDiff(Utility.unStringReplace(attempt.diff), State)) {
            lastAttempt = attempt.id;
            Utility.assign(attempt.patch, State);
            Utility.assign(attempt.patch, patch, true);
            return false;
          }
          else
            return true;
        });
        if (typeof lastAttempt !== 'undefined')
          conns.forEach(function(otherConn) {
            if (otherConn != conn)
              otherConn.sendObj('data-update-state', {'patch': patch});
          });
        conn.sendObj('data-attempts-returned', {'lastAttempt': lastAttempt, 'patch': patch});
      }
    };

    WebSocketServer.on('connection', function(conn) {
      conn.id = id++;
      conn.sendObj = function(channel, message) {
        conn.send(JSON.stringify({'channel': channel, 'message': message}));
      };
      conns.push(conn);

      if ('event-open' in messageHandler) messageHandler['event-open'](conn);

      conn.on('message', function(json) {
        var envelope = JSON.parse(json);
        if (envelope.channel in messageHandler)
          messageHandler[envelope.channel](conn, envelope.message);
      });

      conn.on('close', function() {
        conns.splice(conns.map(function(conn) { return conn.id; }).indexOf(conn.id), 1);
      });
    });
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
    if (typeof left === 'undefined' && typeof right === 'undefined')
      return true;
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
}());
