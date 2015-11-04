var WebSocket = require('./node_modules/ws/index.js');
var events = require('events');
var util = require('util');
var diffpatch = require('./src/diffpatch.js'), diff = diffpatch.diff, patch = diffpatch.patch;

module.exports.Server = function(port, inputState, opts) {
  if (typeof opts === 'undefined')
    opts = {};

  this.websocketServer = new WebSocket.Server({'port': port});
  this.state = inputState || {};
  var _savedState = JSON.parse(JSON.stringify(this.state));
 
  var conns = []; 
  var that = this;
  
  this.on('open', function(conn) {
    conn.sendObj('set-state', {'data': this.state});
  });
  
  this.on('subscribe', function(conn, message) {
    conn.subs.push(message.path);
  });
  
  this.on('attempt', function(conn, message) {
    console.time(1);
    var curState = getByPath(that.state, message.path);
    var successes = message.attempts.filter(function(attempt) {
      if (patch(curState, attempt.delta)) {
        attempt.delta = wrap(attempt.delta, attempt.path);
        return true;
      }
      return false;
    });
    
    conn.sendObj('attempt-returned', {'id': message.id, 'successes': successes.map(function(success) { return success.id; })});
    
    conns.forEach(function(otherConn) {
      if (otherConn === conn)
        return;
        
      var deltas = successes.filter(function(success) {
        for (var i = 0; i < otherConn.subs.length; i++)
          if (getByPath(success.delta, otherConn.subs[i]) !== null)
            return true;
      });
      
      otherConn.sendObj('update-state', {'deltas': deltas});
    });
    console.timeEnd(1);
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

util.inherits(module.exports.Server, events.EventEmitter);

function ConnWrapper(conn) {
  this.conn = conn;
  this.subs = [];
}

ConnWrapper.prototype.sendObj = function(channel, message) {
  if (this.conn.readyState !== WebSocket.CLOSING && this.conn.readyState !== WebSocket.CLOSED)
    this.conn.send(JSON.stringify({'channel': channel, 'message': message}));
};

function isPOJS(prop) {
  return !(
    prop instanceof Date ||
    prop instanceof RegExp ||
    prop instanceof String ||
    prop instanceof Number) &&
    typeof prop === 'object' &&
    prop !== null;
}

//todo: cite source
function getByPath(obj, keyPath){ 
 
    var keys, keyLen, i=0, key;
    keys = keyPath && keyPath.split(".");
    keyLen = keys && keys.length;
 
    while(i < keyLen && obj){
 
        key = keys[i];        
        obj = (typeof obj.get == "function") 
                    ? obj.get(key)
                    : obj[key];                    
        i++;
    }
 
    if(i < keyLen){
        obj = null;
    }
 
    return obj;
}

function wrap(obj, path, root) {
  if (typeof root === 'undefined')
    root = {};

  var c = typeof path === 'string' ? path.split('.') : path;
  if (c.length === 1) {
    root[c[0]] = obj;
    return;
  }
  
  root[c[0]] = {};
  wrap(obj, c.splice(1), root[c[0]]);
  
  return root;
};