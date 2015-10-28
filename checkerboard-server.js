var WebSocket = require('./node_modules/ws/index.js');
var events = require('events');
var util = require('util');
var diffpatch = require('./public/lib/diffpatch.js'), diff = diffpatch.diff, patch = diffpatch.patch;
module.exports.Server = function(port, inputState, opts) {
  if (typeof opts === 'undefined')
    opts = {};

  this.websocketServer = new WebSocket.Server({'port': port});
  this.state = inputState || {};
  var _savedState = JSON.parse(JSON.stringify(this.state));
 
 
  var conns = []; 
  var that = this;
      
  this.on('get', function(conn, message) {
    var data = getByPath(this.state, message.path);
    conn.sendObj('get-returned', {'data': getByPath(this.state, message.path), 'id': message.id});
  });
  
  this.on('subscribe', function(conn, message) {
      conn.subs[message.id] = message.path;
  });
  
  this.on('unsubscribe', function(conn, message) {
    delete conn.subs[message.id];
  });
  
  this.on('attempt', function(conn, message) {
    console.time(1);
    var curState = getByPath(that.state, message.path);
    var successes = message.attempts.filter(function(attempt) {
      if (patch(curState, attempt.delta)) {
        attempt.delta = wrap(attempt.delta, message.path);
        return true;
      }
      return false;
    });
    
    conn.sendObj('attempt-returned', {'id': message.id, 'successes': successes.map(function(attempt) { return attempt.id; })});
    var cache = {}, subdelta;
    
    conns.forEach(function(otherConn) {
      Object.keys(otherConn.subs).forEach(function(id) {
        if (otherConn === conn && otherConn.subs[id] === message.path)
          return;
        
        if (otherConn.subs[id] in cache)
          subdelta = cache[otherConn.subs[id]];
        else
          subdelta = cache[otherConn.subs[id]] = successes.map(function(attempt) {
            return getByPath(attempt.delta, otherConn.subs[id]);
          }).filter(function(delta) { return delta != null; });
  
        if (subdelta.length > 0)
          otherConn.enqueue('update-state', {'id': id, 'deltas': subdelta});
          
      });
    });
    console.timeEnd(1);
  });

  this.websocketServer.on('connection', function(conn) {
    var wrapped = new ConnWrapper(conn, opts);
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
  
  if (typeof opts.refreshRate !== 'undefined') {
    setInterval(function() {
      conns.forEach(function(conn) {
        conn.sendQueue();
      });
    }, opts.refreshRate);
  }
  
  events.EventEmitter.call(this);
}

util.inherits(module.exports.Server, events.EventEmitter);

function ConnWrapper(conn, opts) {
  this.conn = conn;
  this.queue = [];
  this.subs = {};
  this.opts = opts;
}

ConnWrapper.prototype.sendObj = function(channel, message) {
  if (this.conn.readyState !== WebSocket.CLOSING && this.conn.readyState !== WebSocket.CLOSED)
    this.conn.send(JSON.stringify({'channel': channel, 'message': message}));
};

ConnWrapper.prototype.enqueue = function(channel, message) {
  if (typeof this.opts.refreshRate === 'undefined')
    this.sendObj(channel, message);
  else
    this.queue.push({'channel': channel, 'message': message});
};
  
ConnWrapper.prototype.sendQueue = function() {
  var that = this;
  this.queue.forEach(function(msg) {
    that.sendObj(msg.channel, msg.message);
  });
  this.queue = [];
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