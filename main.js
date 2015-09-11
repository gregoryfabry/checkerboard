(function() {

  var WebSocket = require('./node_modules/ws/index.js');
  var Checkerboard = require('./lib/checkerboard.js');

  module.exports.createServer = function(port, inputState) {
    var Event = new (require('events').EventEmitter)();

    if (typeof port === 'undefined')
      throw new Error('No port specified.');

    var WebSocketServer = new WebSocket.Server({'port': port});

    var state = new Checkerboard({} || inputState);

    // external
    Event.state = state;
    Event.WebSocketServer = WebSocketServer;

    var conns = [];

    Event.on('open', function(conn, message) {
      do {
        conn.uuid = uuid();
      } while(conns.map(function(c) { return c !== conn ? c.uuid : undefined; }).indexOf(conn.uuid) > 0);

      conn.sendObj('data-uuid', {'uuid': conn.uuid});
    });
    
    Event.on('close', function(conn) {
      conns.splice(conns.indexOf(conn), 1);
    });

    Event.on('data-attempt-state', function(conn, message) {
      var lastAttempt;
      conn.attempting = true;
      var someFailed = message.attempts.some(function(attempt) {
        if (oneWayDiff(attempt, state) || true) {
          lastAttempt = attempt.id;
          state.merge(attempt);
          return false;
        }
        else
          return true;
      });
      conn.sendObj('data-attempts-returned', {'lastAttempt': lastAttempt});
      conn.attempting = false;
    });

    WebSocketServer.on('connection', function(conn) {
      conn.sendObj = function(channel, message) {
        conn.send(JSON.stringify({'channel': channel, 'message': message}));
      };
      conns.push(conn);

      Event.emit('open', conn);

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

  // http://stackoverflow.com/a/2117523
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }
}());
