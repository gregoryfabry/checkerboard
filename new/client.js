(function(globals) {
  "use strict";

  globals.cb2 = {
    connect: function(ws, callback) {
      return new Connection(ws, callback);
    }
  };

  function Connection(ws, callback) {
    for (var p in Connection.defaults)
      this[p] = Connection.defaults[p];

    this.sendSeqToTimeoutId = {};
    this.sendSeq = 0;

    this.receiveQueue = [];
    this.receiveSeq = 0;

    this.transactionQueue = {};
    this.transactionSeq = 0;

    this.store = {};
    this.observers = [];

    this.playbackStore = null;
    this.log = null;

    this.playback = false;

    this.ws = new WebSocket(ws);
    this.ws.addEventListener("message", this.receive.bind(this));
    this.ws.addEventListener("open", callback.bind(this));
  }

  Connection.defaults = {
    timeout: 1000
  };

  function getLog(connection, callback) {
    var xhttp = new XMLHttpRequest();
    xhttp.onreadystatechange = function() {
      if (xhttp.readyState == 4) {
        connection.log = xhttp.responseText.split("\n").filter(function(line) {
          return line && line.length > 0;
        }).map(function(line) {
          return JSON.parse(line);
        });
        callback();
      }
    };
    xhttp.open("GET", "stores/" + connection.storeId + "?" + (+ new Date()), true);
    xhttp.send();
  }

  Connection.prototype.initializePlayback = function(callback) {
    getLog(this, (function() {
      this.playbackStore = {};
      this.playbackPointer = 0;

      callback();
    }).bind(this));
  };

  Connection.prototype.enablePlayback = function(enablePlayback) {
    if (enablePlayback) {
      this.playback = true;
      this.observers.forEach((function(observer) {
        observer(this.playbackStore);
      }).bind(this));
    } else {
      this.playback = false;
      this.observers.forEach((function(observer) {
        observer(this.store);
      }).bind(this));
    }
  };

  Connection.prototype.goToPlaybackPointer = function(newPointer) {
    if (this.playbackPointer > newPointer) {
      this.playbackPointer = 0;
      this.playbackStore = {};
    }

    while (this.playbackPointer <= newPointer && this.playbackPointer < this.log.length) {
      var line = this.log[this.playbackPointer++];
      var p, path;
      for (p in line.updates) {
        path = p.split(".");
        getByPath(this.playbackStore, path.slice(0, -1))[path.pop()] = JSON.parse(JSON.stringify(line.updates[p]));
      }
    }

    this.observers.forEach((function(observer) {
      observer(this.playbackStore);
    }).bind(this));
  };

  Connection.prototype.sync = function(id) {
    this.storeId = id;
    this.send("sync", id);
  };

  Connection.prototype.addObserver = function(observer) {
    this.observers.push(observer);
  };

  Connection.prototype.removeObserver = function(observer) {
    this.observers.splice(this.observers.indexOf(observer), 1);
  };

  Connection.prototype.transaction = function(paths, action, seq) {
    if (this.playback)
      return;

    seq = (typeof seq !== "undefined" ? seq : this.transactionSeq++);

    paths = paths.map((function(path) {
      if (typeof path === "string" || path instanceof String)
        return path.split(".");

      return path;
    }).bind(this));

    var dependencies = paths.map((function(path) {
      return getByPath(this.store, path);
    }).bind(this));

    action.apply({
      props: paths
    }, dependencies);

    var versions = {};
    var updates = {};
    for (var i = 0; i < paths.length; i++) {
      var version = dependencies[i]._id || 0;
      versions[paths[i].join(".")] = version;
      dependencies[i]._id = version + 1;
      updates[paths[i].join(".")] = dependencies[i];
    }

    this.transactionQueue[seq] = {paths: paths, action: action};

    this.send("transaction", {
      seq: seq,
      storeId: this.storeId,
      versions: versions,
      updates: updates
    });

    this.observers.forEach((function(observer) {
      observer(this.store);
    }).bind(this));
  };

  function getByPath(obj, path, i) {
    if (typeof i === "undefined")
      i = 0;

    if (path.length - i === 0 || path[i] === "")
      return obj;

    if (path[i] === "+") {
      path[i] = arrayHelpers.push(obj, {}) - 1;
    } else if (!(path[i] in obj)) {
      obj[path[i]] = {};
    }

    var next = obj[path[i]];

    return getByPath(next, path, i + 1);
  }

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
        this.processReceive(this.receiveQueue.shift());
      }
    }
  };

  Connection.prototype.processReceive = function(envelope) {
    var channel = envelope.channel,
        message = envelope.message;

    var p, path;
    switch(channel) {
      case "set-store":
        if (message.storeId !== this.storeId)
          break;

        this.store = message.store;

        if (this.playback)
          return;

        this.observers.forEach((function(observer) {
          observer(this.store);
        }).bind(this));

        break;
      case "updates":
        if (message.storeId !== this.storeId)
          break;

        for (p in message.updates) {
          path = p.split(".");
          getByPath(this.store, path.slice(0, -1))[path.pop()] = message.updates[p];
        }

        if (this.playback)
          return;

        this.observers.forEach((function(observer) {
          observer(this.store);
        }).bind(this));

        break;
      case "transaction-success":
        delete this.transactionQueue[message.seq];
        break;
      case "transaction-failure":
        var transaction = this.transactionQueue[message.seq];
        delete this.transactionQueue[message.seq];
        this.transaction(transaction.paths, transaction.action, message.seq);
        break;
    }
  };

  var arrayHelpers;
  arrayHelpers = globals.cb2.array = {
    length: function(arr) {
      return Object.keys(arr).length  -
        ("_id" in arr ? 1 : 0);
    },
    forEach: function(arr, callback, thisArg) {
      var length = arrayHelpers.length(arr);
      for (var i = 0; i < length; i++)
        callback.call(thisArg, arr[i], i, arr);
    },
    map: function(arr, callback, thisArg) {
      var length = arrayHelpers.length(arr);
      var toReturn = {};

      arrayHelpers.forEach(arr, function(item, i) {
        toReturn[i] = callback.call(thisArg, item, i, arr);
      });

      return toReturn;
    },
    push: function(arr) {
      var savedLength = arr.length;
      var hasLength = "length" in arr;
      arr.length = arrayHelpers.length(arr);

      var toReturn = Array.prototype.push.apply(arr, Array.prototype.slice.call(arguments, 1));

      if (hasLength)
        arr.length = savedLength;
      else
        delete arr.length;

      return toReturn;
    },
    pop: function(arr) {
      var savedLength = arr.length;
      var hasLength = "length" in arr;
      arr.length = arrayHelpers.length(arr);

      var toReturn = Array.prototype.pop.apply(arr);

      if (hasLength)
        arr.length = savedLength;
      else
        delete arr.length;

      return toReturn;
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
