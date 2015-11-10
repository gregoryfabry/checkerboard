  stm = require('stm');
  })();
  if (window) {
    if (typeof window.define !== 'undefined')
      window.define('checkerboard', stm);
    else
      window.checkerboard = stm;
  }
}());