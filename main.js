(function() {

  var WebSocket = require('./node_modules/ws/index.js');
  var Checkerboard = require('./lib/checkerboard.js').Checkerboard;

  module.exports.createServer = function(port, inputState, refreshRate) {
    var Event = new (require('events').EventEmitter)();

    if (typeof port === 'undefined')
      throw new Error('No port specified.');

    var WebSocketServer = new WebSocket.Server({'port': port});

    var state = new Checkerboard.DiffableState({} || inputState);

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
        if (oneWayDiff(state.proxy, attempt.diff)) {
          lastAttempt = attempt.id;
          state.merge(attempt.patch);
          return false;
        }
        else
          return true;
      });
      conn.sendObj('data-attempts-returned', {'lastAttempt': lastAttempt});
      conn.attempting = false;
    });
    
    Event.on('data-subscribe', function(conn, message) {
      state.subscribe(message.path, function(data, change) {
        if (conn.attempting)
          return;
        var components = message.path.split('.');
        var leafParent = {};
        var leafProp = components[components.length - 1];
        var root;
        for (var i = components.length - 1; i >= 0; i--) {
          var n = {};
          n[components[i]] = root || leafParent;
          root = n;
          if (i === components.length - 1)
            leafParent = root;
        }
        if (typeof change === 'undefined')
          leafParent[leafProp] = data;
        else
          leafParent[leafProp] = change;
        conn.enqueue('data-update-state', {'patch': root});
      });
    });

    WebSocketServer.on('connection', function(conn) {
      conn.sendObj = function(channel, message) {
        if (conn.readyState !== WebSocket.CLOSING && conn.readyState !== WebSocket.CLOSED)
          conn.send(JSON.stringify({'channel': channel, 'message': message}));
      };
      conn.queue = [];
      conn.enqueue = function(channel, message) {
        if (typeof refreshRate === 'undefined')
          conn.sendObj(channel,message);
        else
          conn.queue.push({'channel': channel, 'message': message});
      }
      
      conn.sendQueue = function() {
        conn.queue.forEach(function(msg) {
          conn.sendObj(msg.channel, msg.message);
        });
        conn.queue.splice(0, conn.queue.length);
      }
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
    
    if (typeof refreshRate !== 'undefined') {
      setInterval(function() {
        conns.forEach(function(conn) {
          conn.sendQueue();
        });
      }, refreshRate);
    }
    return Event;
  };
  
  function oneWayDiff(origin, comparand) {
    if (!(isPOJS(origin) && isPOJS(comparand)))
      return false;
    
    var comp;
    for (var prop in comparand) {
      comp = (isPOJS(comparand[prop]) && '$undefined' in comparand[prop]) ? undefined : comparand[prop];
      if (isPOJS(origin[prop]) || isPOJS(comp))
        return oneWayDiff(origin[prop], comp);
      else if (typeof comp !== typeof origin[prop])
        return false;
      else if (comp !== origin[prop])
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
      typeof prop === 'object' &&
      prop !== null;
  }

  // http://stackoverflow.com/a/2117523
  function uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
      return v.toString(16);
    });
  }
}());
