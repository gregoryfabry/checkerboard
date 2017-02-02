var WebSocket = require("ws");
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;

module.exports.server = function(port, dir) {
  return new Server(port, dir);
};

function Server(port, dir) {
  this.server = new WebSocket.Server({port: port});
  this.dir = dir;
  this.connections = [];

  this.stores = {};
  this.subscriptions = {};

  this.server.on("connection", (function(ws) {
    var connection = new Connection(ws);

    connection.on("message", this.processReceive.bind(this));
    connection.on("close", (function() {
      this.connections.splice(this.connections.indexOf(connection), 1);
    }).bind(this));
    this.connections.push(connection);
  }).bind(this));

  EventEmitter.call(this);
}

Server.prototype.processReceive = function(connection, envelope) {
  var channel = envelope.channel,
      message = envelope.message;

  switch(channel) {
    case "sync":
      var id = message;

      if (typeof connection.storeId !==  "undefined") {
        var indexOfConnection = this.subscriptions[connection.storeId].indexOf(connection);
        this.subscriptions[connection.storeId].splice(indexOfConnection, 1);
      }

      if (!(id in this.stores)) {
        this.stores[id] = {};
        this.subscriptions[id] = [];
      }

      this.subscriptions[id].push(connection);
      connection.storeId = id;

      connection.send("set-store", {
        storeId: id,
        store: this.stores[id]
      });
      break;
    case "transaction":
      var store = this.stores[connection.storeId];
      if (connection.storeId !== message.storeId)
        return;
      var p, path;
      for (p in message.versions) {
        path = p.split(".");
        if ((getByPath(store, path)._id || 0) !== message.versions[p]) {
          var updates = {};
          for (p in message.versions) {
            path = p.split(".");
            updates[p] = getByPath(store, path);
            connection.send("transaction-failure", {
              seq: message.seq,
              updates: updates
            });

            return;
          }
        }
      }

      for (p in message.updates) {
        path = p.split(".");
        getByPath(store, path.slice(0, -1))[path.pop()] = message.updates[p];
      }

      this.subscriptions[message.storeId].forEach(function(subscription) {
        if (subscription === connection)
          return;

        subscription.send("updates", {
          storeId: message.storeId,
          updates: message.updates
        });
      });

      connection.send("transaction-success", {
        seq: message.seq
      });
      break;
  }
};

function getByPath(obj, path) {
  if (path.length === 0)
    return obj;

  if (!(path[0] in obj))
    obj[path[0]] = {};

  var next = obj[path[0]];

  return getByPath(next, path.slice(1));
}

function Connection(ws) {
  for (var p in this.defaults)
    this[p] = this.defaults[p];

  this.ws = ws;

  this.sendSeqToTimeoutId = {};
  this.sendSeq = 0;

  this.receiveQueue = [];
  this.receiveSeq = 0;

  this.ws.on("message", this.receive.bind(this));

  EventEmitter.call(this);
}

inherits(Connection, EventEmitter);

Connection.prototype.defaults = {
  timeout: 1000
};

Connection.prototype.send = function(channel, message, seq) {
  seq = (typeof seq !== "undefined" ? seq : this.sendSeq++);

  if (this.ws.readyState !== 1)
    return;

  this.ws.send(JSON.stringify(new Envelope(channel, message, seq)));

  this.sendSeqToTimeoutId[seq] = setTimeout((function() {
    this.send(channel, message, seq);
  }).bind(this), this.timeout);
};

Connection.prototype.receive = function(json) {
  var data = JSON.parse(json);
  var envelope = new Envelope(data.channel, data.message, data.seq);

  if (envelope.channel === "ack") {
    clearTimeout(this.sendSeqToTimeoutId[envelope.seq]);
    delete this.sendSeqToTimeoutId[envelope.seq];
  } else if (envelope.seq >= this.receiveSeq) {
    this.ws.send(JSON.stringify(new Ack(envelope.seq)));

    this.receiveQueue.push(envelope);
    this.receiveQueue.sort(function(a, b) {
      return a.seq - b.seq;
    });

    while (this.receiveQueue.length > 0 && this.receiveSeq === this.receiveQueue[0].seq) {
      this.receiveSeq++;
      this.emit("message", this, this.receiveQueue.shift());
    }
  }
};

function Envelope(channel, message, seq) {
  this.channel = channel;
  this.message = message;
  this.seq = seq;
}

function Ack(seq) {
  this.channel = "ack";
  this.seq = seq;
}
