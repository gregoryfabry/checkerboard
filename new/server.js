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

  this.server.on("connection", (function(ws) {
    var connection = new Connection(ws);

    connection.on("message", this.processReceive.bind(this));

    this.connections.push(connection);
  }).bind(this));

  EventEmitter.call(this);
}

Server.prototype.processReceive = function(envelope) {
  var channel = envelope.channel,
      message = envelope.message;

  switch(channel) {
    
  }
};

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

  this.ws.send(JSON.stringify(new Envelope(channel, message, seq)));
  this.sendSeqToTimeoutId[seq] = setTimeout((function() {
    this.send(channel, message, seq);
  }).bind(this), this.timeout);
};

Connection.prototype.receive = function(json) {
  var data = JSON.parse(json);
  var envelope = new Envelope(data.channel, data.message, data.seq);

  console.log(data);

  if (envelope.channel === "ack") {
    clearTimeout(this.sendSeqToTimeoutId[envelope.seq]);
    delete this.sendSeqToTimeoutId[envelope.seq];
  } else if (envelope.seq >= this.receiveSeq) {
    console.log("receive");
    this.ws.send(JSON.stringify(new Ack(envelope.seq)));

    this.receiveQueue.push(envelope);
    this.receiveQueue.sort(function(a, b) {
      return a.seq - b.seq;
    });

    while (this.receiveQueue.length > 0 && this.receiveSeq === this.receiveQueue[0].seq) {
      this.receiveSeq++;
      this.emit("message", this.receiveQueue.splice(0, 1));
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
