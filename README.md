Checkerboard is a library that lets you easily create shared state among clients with zero server-side configuration. It has two components: a server back-end written with node.js, and a client library for the browser. Its goal is simplicity: a collaborative whiteboard is less than sixty lines of JavaScript.

Checkerboard creates a store that is automatically synced across all devices. Developers can focus on writing applications, not writing networking logic.

## Background

Read about Checkerboard [here](https://medium.com/@gregoryfabry/writing-a-collaborative-whiteboard-in-70-lines-of-javascript-part-one-b146d3bffb5e).

## Install

    npm install checkerboard --save

## Example

    npm install checkerboard-demo
    node demo-server

## Use

This code follows the *coords.html* demo in the checkerboard-demo repository.

### Server

    var port = 9998;
    var Checkerboard = require('checkerboard');
    var CheckerboardServer = new Checkerboard.Server(port, [optionalState]);

### Browser

Include:

    <script src="build/out.js"></script>

Then:

    var stm = new checkerboard.STM('ws://localhost:9998/');

#### Actions

First, create a set of actions:

    stm.action('change-coords')
      .onReceive(function(x, y) {
        this.x = x;
        this.y = y;
      });
      
When an action is called, its *this* keyword is set to the object it is called on.

Then, call the init function:

    stm.init(function(store) {
      store.addObserver(function(newValue, oldValue) {
        if (oldValue !== null)
          console.log("Coords changed from " + JSON.stringify(oldValue) + " to " + JSON.stringify(newValue));
        else
          console.log("Coords are set at " + JSON.stringify(newValue));
      });
      
      document.body.addEventListener('click', function(e) {
        store.sendAction('change-coords', e.pageX, e.pageY);
      });
    });
    
In the init function, you can attach observers to the store and create event handlers that send actions to the store.

Now, launch the server and open the client webpage in two tabs. Open the console and observe what happens when you click on the page. (Note: you will want to set body height to '100vh' in CSS, otherwise the body won't extend all the way down the page.)

## API (browser)

### new checkerboard.STM(address)

Create a new instance of the checkerboard framework. Address should point to the WebSocket server/port.

### stm.action(name).onReceive(callback).onRevert(callback)

Registers an action. The onReceive callback is invoked when the action is sent to an object in the store. The onRevert callback is invoked if the action fails, before it is retried.

### stm.init(callback)

Initializes the framework. Callback takes one parameter, store.

### store.addObserver(callback)

Adds an observer on the store or on any nested object. Callback is invoked with two parameters, newValue and oldValue, whenever the object is changed (locally or by another client). When the observer is first added the callback is immediately called with initial data as newValue and oldValue set to null.

### store.sendAction(action[, parameter1[, parameter2[, ...]]])

Sends an action to the store or any nested object. The actions onReceive method is called, with its this keyword set to the object that sendAction was called on.

## Notes

- The store must only be accessed in the init callback or in an observer.  
- Actions should not be sent inside other actions.  
- Objects in the store are only updated when they have an observer.  
- Observers can only be attached and actions can only be sent to objects, not primitives.  
- UI should only be updated in an observer.