if (typeof define !== 'function') { var define = require('amdefine')(module) }

define(['exports'], function(exports) {
  function isPOJS(obj) {
    return !(
      obj instanceof Date ||
      obj instanceof RegExp ||
      obj instanceof String ||
      obj instanceof Number) &&
      typeof obj === 'object' &&
      obj !== null;
  }
  
  function getByPath(obj, path) {
    if (path === "")
      return obj;
  
    var keys = path.split('.');
    
    for (var i = 0; i < keys.length && obj; i++)
        obj = obj[keys[i]];
        
    return i >= keys.length ? obj : null;
  }
  
  function wrap(obj, path, root) {
    if (path === "")
      return obj;
    
    if (typeof root === 'undefined')
      root = {};

    var c = typeof path === 'string' ? path.split('.') : path;
    if (c.length === 1) {
      root[c[0]] = obj;
      return root;
    }
    
    root[c[0]] = {};
    wrap(obj, c.splice(1), root[c[0]]);
    
    return root;
  }
  
  // is b a subdir of or equiv to a?
  function isChild(a, b) {
    if (a === "")
      return true;
      
    a = a.split('.');
    b = b.split('.');
    
    var i;
    for (i = 0; i < a.length; i++)
      if (a[i] !== b[i] || i >= b.length)
        return -1;
        
    return b.length - i;
  }
  
  exports.isPOJS = isPOJS;
  exports.getByPath = getByPath;
  exports.wrap = wrap;
  exports.isChild = isChild;
});