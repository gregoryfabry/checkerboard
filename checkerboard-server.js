var WebSocket = require('./node_modules/ws/index.js');
var events = require('events');
var nodeutil = require('util');
var diffpatch = require('./src/diffpatch.js'), diff = diffpatch.diff, patch = diffpatch.patch;
var util = require('./src/util.js'), isPOJS = util.isPOJS, getByPath = util.getByPath, wrap = util.wrap;

module.exports.Server = function(port, inputState, opts) {
  if (typeof opts === 'undefined')
    opts = {};

  this.websocketServer = new WebSocket.Server({'port': port});
  this.state = inputState || {};
 
  var conns = []; 
  var that = this;
  
  this.on('open', function(conn) {
    conn.sendObj('set-state', {'data': this.state});
  });
  
  this.on('subscribe', function(conn, message) {
    conn.subs.push(message.path);
  });
  
  this.on('attempt', function(conn, message) {
    var successes = message.attempts.filter(function(attempt) {
      return patch(getByPath(that.state, attempt.path), attempt.delta)
    });
    
    conn.sendObj('attempt-returned', {'id': message.id, 'successes': successes.map(function(success) { return success.id; })});
    
    conns.forEach(function(otherConn) {
      if (otherConn === conn)
        return;
        
      var deltas = successes.filter(function(success) {
        for (var i = 0; i < otherConn.subs.length; i++) {
          if (getByPath(wrap(success.delta, success.path), otherConn.subs[i]) !== null)
            return true;
          }
      });
      
      if (deltas.length > 0)
        otherConn.sendObj('update-state', {'deltas': deltas});
    });
  });

  this.websocketServer.on('connection', function(conn) {
    var wrapped = new ConnWrapper(conn);
    conns.push(wrapped);

    that.emit('open', wrapped);

    conn.on('message', function(json) {
      var envelope = JSON.parse(json);
      if (typeof envelope.channel !== 'undefined')
        that.emit(envelope.channel, wrapped, envelope.message);
    });

    conn.on('close', function() {
      that.emit('close', wrapped);
      conns.splice(conns.indexOf(wrapped), 1);
    });
  });
  
  events.EventEmitter.call(this);
}

nodeutil.inherits(module.exports.Server, events.EventEmitter);

function ConnWrapper(conn) {
  this.conn = conn;
  this.subs = [];
}

ConnWrapper.prototype.sendObj = function(channel, message) {
  if (this.conn.readyState !== WebSocket.CLOSING && this.conn.readyState !== WebSocket.CLOSED)
    this.conn.send(JSON.stringify({'channel': channel, 'message': message}));
};