(function(globals) {
  "use strict";

  globals.cb2 = {
    connect: function(ws, callback) {
      return new Connection(ws, callback);
    }
  };

  function Connection(ws, callback) {
    for (var p in this.defaults)
      this[p] = this.defaults[p];

    this.observers = [];
    this.actions = {};

    this.sendSeqToTimeoutId = {};
    this.sendSeq = 0;

    this.receiveQueue = [];
    this.receiveSeq = 0;

    this.ws = new WebSocket(ws);
    this.ws.addEventListener("message", this.receive.bind(this));
    this.ws.addEventListener("open", callback.bind(this));
  }

  Connection.prototype.defaults = {
    timeout: 1000
  };

  

  // Sending and receiving logic.
  Connection.prototype.send = function(channel, message, seq) {
    seq = (typeof seq !== "undefined" ? seq : this.sendSeq++);

    this.ws.send(JSON.stringify(new Envelope(channel, message, seq)));
    this.sendSeqToTimeoutId[seq] = setTimeout((function() {
      this.send(channel, message, seq);
    }).bind(this), this.timeout);
  };

  Connection.prototype.receive = function(e) {
    var envelope = Object.assign(new Envelope(), JSON.parse(e.data));

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
        this.processReceive(this.receiveQueue.splice(0, 1));
      }
    }
  };

  Connection.prototype.processReceive = function(envelope) {
    var channel = envelope.channel,
        message = envelope.message;

    switch(channel) {
      case "set-state":
        this.state = message;
        break;
    }
  };

  // Helpers.
  function Envelope(channel, message, seq) {
    this.channel = channel;
    this.message = message;
    this.seq = seq;
  }

  function Ack(seq) {
    this.channel = "ack";
    this.seq = seq;
  }
}((1, eval)("this")));
