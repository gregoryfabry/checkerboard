![cards example](/examples/demo.gif?raw=true)

Checkerboard is a library that lets you easily create shared state among clients with zero server-side logic. It has two components: a server back-end written with node.js, and a client library for the browser. Its goal is simplicity: the cards demo is less than a hundred lines of JavaScript.

## Theory

Suppose you have some state that you want to share among multiple networked clients. Each client can perform some change on the state at any time. How can we ensure that the clients' states stay consistent and in sync?

For example:

Let's say the state has a counter, an integer that can be incremented by one. If client A increments the counter, and then client B also increments the counter before it receives the data from client A, client B's change will be lost.

Instead of blindly making a change, a client submits an attempt. Each attempt has a 'diff', which is a record of what data the client has, and a 'patch', which is the change the client wants to make. When the server receives an attempt, it compares the diff to its own state. If the client has accurate data, then it applies the patch. Otherwise, it notifies that client with the updated state and lets it try again.

The 'diff' doesn't contain the entire state. Rather, it contains only the parts of the state that the client depended on to make a change. Even if a value is not written, a change might depend on a value that is read. (For example, if a value A is less than 10, add 1 to value B - we don't write value A but we want to make sure we have the right data).

## Install

    npm install checkerboard --save

## Example

To run the example:

    $ cd examples
    $ node server.js

In examples/cards.html change the WebSocket address to whatever address you are hosting on. (localhost works fine if you are just on your own machine). Then, open cards.html in your browser. Try opening it in two tabs and seeing how changes are synced, and persist when you refresh.

## Use

### Server

    var port = 904;
    var Checkerboard = require('checkerboard');
    var CheckerboardServer = new Checkerboard.Server(port, [optionalState]);

The server constructor takes one or two arguments: a port, and optionally a starting state. If you do not provide a starting state, it will just create an empty object and use that.

    var state = CheckerboardServer.state; // save to file, etc

### Browser

Include:

    <script src="lib/checkerboard.js"></script>
    <script src="lib/q.min.js"></script>

Then:

    var ws = new WebSocket('ws://localhost:904');
    ws.onopen = function() {
      var cb = new Checkerboard(ws);
    }

On the client side, Checkerboard exposes two events and three methods.

    cb.onready = function(state) { /* ... */ } // called when initial state received

    cb.onchange = function(state) { /* ... */ } // called when state changed (NOT on initial receive!)

Note that you cannot change state in an onready or onchange function. Whenever you want to change the state, you must call try(callback) like this:

    cb.try(function(state) {
      state.property('newValue');
    });

The try method, as its name implies, tries to make a state change. If it fails, then it tries again until it succeeds.

The callback function receives one parameter, which is a "diffable state." It uses getters and setters to change its values. Here is how getters and setters are used:

    // read a property
    state.property();
    // read a property on a nested object. notice parens only on last term
    state.nestedObject.property();
    // write a property that already exists
    state.property('newValue');
    // if you're doing that, then you might want to make sure the property exists:
    if ('property' in state) state.property('newValue');
    // because if it doesn't:
    state.nonExistantProperty('newValue') // ERROR!
    // write a property that may or may not exist (safer):
    state('newProperty', 'newValue');
    // read an array value
    state.array[0]();
    // write an array value that exists (dangerous - see above)
    state.array[0]('newValue');
    // otherwise
    state.array(0, 'newValue');

Once you make some changes, you want to call the sync() method:

    cb.try(function(state) {
      state.property('newValue');
    });

    cb.sync();

Calling sync() with no parameters does a single sync. Calling sync(timeout) with a value in milliseconds sets an interval which repeatedly syncs state. Of course, if there are no state changes then nothing is submitted to the server. Changes from the server ('upstream') are always pushed. Calling sync(null) clears the timeout.

Checkerboard also has a uuid() function, which returns an id unique to that connection. This is useful if you want to 'claim' something (for example in cards.html when a card is picked up, the client sets the card's hold property to its uuid, so no other client can pick it up.)

Lastly, try() returns a promise, so you can call a function when the state change is successful:

    cb.try(function(state) {
      /* ... */
    }).then(function(newState) {
      // render some html with correct state, etc.
    }).done();

Checkerboard uses Q for promises. Two caveats: changes made in a then callback WON'T be saved - the new state is read only. Any state change always occurs in a try block. Also, I recommend calling done() or using some of Q's error handling features, otherwise any errors in your callbacks will be silenced.

## Current issues

v0.0.1:
- Overwriting an entire array or object will fail to erase previous properties.
