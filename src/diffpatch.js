if (typeof define !== 'function') { var define = require('amdefine')(module) }

define(['exports'], function(exports) {
  function diff(origin, comparand) {
    if (!isPOJS(origin) || !isPOJS(comparand))
      throw new Error('Attempting to diff a non-object');
    var delta = {}, props = [];
    
    var originProps = Object.keys(origin), comparandProps = Object.keys(comparand);
    [].push.apply(props, originProps);
    [].push.apply(props, comparandProps);
    props = props.filter(function(element, index, array) {
      return this.hasOwnProperty(element) ? false : this[element] = true;
    }, {});
    
    var fPropInOrigin, fPropInComparand, fUndefinedInOrigin, fUndefinedInComparand, fTypesMatch, fObjInOrigin, fObjInComparand;
    for (var i = 0; i < props.length; i++) {
      fPropInOrigin = props[i] in origin;
      fPropInComparand = props[i] in comparand;
      fUndefinedInOrigin = typeof origin[props[i]] === 'undefined';
      fUndefinedInComparand = typeof comparand[props[i]] === 'undefined';
      fTypesMatch = typeof comparand[props[i]] === typeof origin[props[i]];
      fObjInOrigin = fPropInOrigin && !fUndefinedInOrigin && isPOJS(origin[props[i]]);
      fObjInComparand = fPropInComparand && !fUndefinedInComparand && isPOJS(comparand[props[i]]);
      
      if (fPropInOrigin && fUndefinedInOrigin && !fUndefinedInComparand)
        delta[props[i]] = [1, 1, comparand[props[i]]]; //{_op: 'mu', nmu: comparand[props[i]]};
      else if (fPropInComparand && (!fUndefinedInOrigin && fPropInOrigin) && fUndefinedInComparand)
        delta[props[i]] = [1, 2, null, origin[props[i]]]; //{_op: 'su', osu: origin[props[i]]};
      else if (!fPropInOrigin && fPropInComparand && fUndefinedInComparand)
        delta[props[i]] = [0, 2];
      else if (!fPropInOrigin && fPropInComparand )
        delta[props[i]] = [0, 0, comparand[props[i]]]; //{_op: 's', ns: comparand[props[i]]};
      else if (fPropInOrigin && !fPropInComparand)
        delta[props[i]] = [2, 0, null, origin[props[i]]]; //{_op: 'd', od: origin[props[i]]}
      else if (fUndefinedInOrigin && !fPropInComparand)
        delta[props[i]] = [2, 1]; //{_op: 'du'};
      else if (!fTypesMatch || (fTypesMatch && !fObjInOrigin && !fObjInComparand && origin[props[i]] !== comparand[props[i]]))
        delta[props[i]] = [1, 0, comparand[props[i]], origin[props[i]]]; //{_op: 'm', om: origin[props[i]], nm: comparand[props[i]]};
      else if (fObjInOrigin && fObjInComparand && typeof (subDelta = diff(origin[props[i]], comparand[props[i]])) !== 'undefined')
        delta[props[i]] = subDelta;
    }

    if (Object.keys(delta).length > 0)
      return delta;
  }

  function patch(target, delta, checked) {
    if (typeof delta === 'undefined')
      return true;
    
    if (delta instanceof Array) {
      target = {0: target};
      delta = {0: delta};
    }
    
    if (typeof checked === 'undefined' && !check(target, delta))
      return false;
      
    Object.keys(delta).forEach(function(prop) {
      if (!(delta[prop] instanceof Array))
        patch(target[prop], delta[prop], true);
      else {
        switch(delta[prop][0]) {
          case 0:  
          case 1:  target[prop] = delta[prop][1] !== 1 ? delta[prop][2] : undefined;   break;
          case 2:
            if (target instanceof Array)
              target.splice(prop, 1)
            else
              delete target[prop];
        }
      }
    });
    
    return true;
  }

  function check(target, delta) {
    if (typeof target === 'undefined' || typeof delta === 'undefined')
      return typeof target === 'undefined' && typeof delta === 'undefined';
    return Object.keys(delta).every(function(prop) {
      if (!(delta[prop] instanceof Array))
        return check(target[prop], delta[prop]);
      try {
        switch(delta[prop][0]) {
          case 0: return !(prop in target);
          case 1: 
          case 2: return deepequals(target[prop], delta[prop][3]);
        }
      } catch (e) {
        return false;
      };
    });
  }

  function deepequals(origin, comparand, props) {
    if (!isPOJS(origin))
      return origin === comparand;
    
    if (typeof props === 'undefined')
      [].push.apply(props = Object.keys(origin), Object.keys(comparand));
      
    for (var i = 0, isObj; i < props.length; i++) {
      if (typeof origin[props[i]] !== typeof comparand[props[i]] || ((isObj = isPOJS(origin[props[i]])) !== isPOJS(comparand[props[i]])) )
        return false;
      else if (isObj && !deepequals(origin[props[i]], comparand[props[i]]))
        return false;
      else if (!isObj && origin[props[i]] !== comparand[props[i]])
        return false;
    }
    
    return true;
  }
  
  
  function isPOJS(obj) {
    return !(
      obj instanceof Date ||
      obj instanceof RegExp ||
      obj instanceof String ||
      obj instanceof Number) &&
      typeof obj === 'object' &&
      obj !== null;
  }
  
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
  
  exports.diff = diff;
  exports.patch = patch;
  exports.isPOJS = isPOJS;
  exports.getByPath = getByPath;
  exports.wrap = wrap;
});
