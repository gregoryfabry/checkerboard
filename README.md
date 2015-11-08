Checkerboard is a library that lets you easily create shared state among clients with zero server-side logic. It has two components: a server back-end written with node.js, and a client library for the browser. Its goal is simplicity: a collaborative whiteboard is less than sixty lines of JavaScript.

## Background

Read about Checkerboard [here](https://medium.com/@gregoryfabry/writing-a-collaborative-whiteboard-in-70-lines-of-javascript-part-one-b146d3bffb5e).

## Install

    npm install checkerboard --save

## Example

    npm install checkerboard-demo
    node demo-server

## Use

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
        console.log("Coords changed from " + newValue + " to " oldValue");
      });
      
      document.body.addEventListener('click', function(e) {
        store.sendAction('change-coords', e.pageX, e.pageY);
      });
    });
    
In the init function, you can attach observers to the store and create event handlers that send actions to the store.

Now, launch the server and open the client webpage in two tabs. Open the console and observe what happens when you click on the page. (Note: you will want to set body height to '100vh' in CSS, otherwise the body won't extend all the way down the page.