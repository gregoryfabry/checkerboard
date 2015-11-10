if (typeof define !== 'function') { var define = require('amdefine')(module) }

define(['exports', 'util'], function(exports, util) {
  function diff(origin, comparand) {
    if (!isPOJS(origin) || !isPOJS(comparand))
      throw new Error('Attempting to diff a non-object');
    var delta = {}, props = {};
    
    var isArray = origin instanceof Array;
    
    if (!isArray) {
      var originProps = Object.keys(origin), comparandProps = Object.keys(comparand);
      for (var i = 0; i < originProps.length; i++)
        props[originProps[i]] = true;
          
      for (var i = 0; i < comparandProps.length; i++)
        props[comparandProps[i]] = true;
          
      props = Object.keys(props);
    }
  
    var fPropInOrigin, fPropInComparand, fUndefinedInOrigin, fUndefinedInComparand, fTypesMatch, fObjInOrigin, fObjInComparand;
    var prop, oObj, cObj;
    for (var i = 0; i < (isArray ? Math.max(origin.length, comparand.length) : props.length); i++) {
      prop = isArray ? i : props[i];
      oObj = origin[prop];
      cObj = comparand[prop];
        
      fPropInOrigin = origin.hasOwnProperty(prop);
      fPropInComparand = comparand.hasOwnProperty(prop);
      fUndefinedInOrigin = oObj === void 0;
      fUndefinedInComparand = cObj === void 0;
      fTypesMatch = typeof cObj === typeof oObj;
      fObjInOrigin = fPropInOrigin && !fUndefinedInOrigin && isPOJS(oObj);
      fObjInComparand = fPropInComparand && !fUndefinedInComparand && isPOJS(cObj);
      
      if (fPropInOrigin && fUndefinedInOrigin && !fUndefinedInComparand)
        delta[prop] = [1, 1, cObj]; //{_op: 'mu', nmu: cObj};
      else if (fPropInComparand && (!fUndefinedInOrigin && fPropInOrigin) && fUndefinedInComparand)
        delta[prop] = [1, 2, null, oObj]; //{_op: 'su', osu: oObj};
      else if (!fPropInOrigin && fPropInComparand && fUndefinedInComparand)
        delta[prop] = [0, 2];
      else if (!fPropInOrigin && fPropInComparand)
        delta[prop] = [0, 0, cObj]; //{_op: 's', ns: cObj};
      else if (fPropInOrigin && !fPropInComparand)
        delta[prop] = [2, 0, null, oObj]; //{_op: 'd', od: oObj}
      else if (fUndefinedInOrigin && !fPropInComparand)
        delta[prop] = [2, 1]; //{_op: 'du'};
      else if (!fTypesMatch || (fTypesMatch && !fObjInOrigin && !fObjInComparand && oObj !== cObj))
        delta[prop] = [1, 0, cObj, oObj]; //{_op: 'm', om: oObj, nm: cObj};
      else if (fObjInOrigin && fObjInComparand && typeof (subDelta = diff(oObj, cObj)) !== 'undefined')
        delta[prop] = subDelta;
    }

    if (Object.keys(delta).length > 0)
      return delta;
  }
  
  function reverse(delta) {
    var toReturn = {};
    for (var prop in delta) {
      if (!delta.hasOwnProperty(prop))
        continue;
      if (!(delta[prop] instanceof Array))
        toReturn[prop] = reverse(delta[prop]);
      else {
        toReturn[prop] = [];
        switch(delta[prop][0]) {
          case 0: // set
            toReturn[prop][0] = 2; // delete
            if (delta[prop][1] == 2) // set undefined
              toReturn[prop][1] = 1;
            else {
              toReturn[prop][1] = 0;
              toReturn[prop][2] = null;
              toReturn[prop][3] = delta[prop][2];
            }
            break;
          case 1:
            toReturn[prop][0] = 1;
            if (delta[prop][1] === 0) {
              toReturn[prop][1] = 0;
              toReturn[prop][2] = delta[prop][3];
              toReturn[prop][3] = delta[prop][2];
            } else if (delta[prop][1] === 1) {
              toReturn[prop][1] = 2;
              toReturn[prop][2] = null
              toReturn[prop][3] = delta[prop][2];
            } else {
              toReturn[prop][1] = 1;
              toReturn[prop][2] = delta[prop][3];
            }
            break;
          case 2:
            toReturn[prop][0] = 0;
            if (delta[prop][1] === 0) {
              toReturn[prop][1] = 0;
              toReturn[prop][2] = delta[prop][3];
            } else {
              toReturn[prop][1] = 2;
            }
            break;
        }
      }
    }
    return toReturn;
  }

  var placeholder = {};
  function patch(target, delta, checked) {
    if (typeof delta === 'undefined')
      return true;
    
    if (typeof checked === 'undefined' && !check(target, delta)) {
      return false;
    }
      
    Object.keys(delta).forEach(function(prop) {
      if (!(delta[prop] instanceof Array)) {
        patch(target[prop], delta[prop], true);
        if (target[prop] instanceof Array) {
          var newArray = [];
          
          for (var i = 0; i < target[prop].length; i++)
            if (target[prop][i] !== placeholder)
              newArray[newArray.length] = target[prop][i];
          
          target[prop] = newArray;
        }
      } else {
        switch(delta[prop][0]) {
          case 0:  
          case 1:  target[prop] = delta[prop][1] !== 2 ? delta[prop][2] : undefined;   break;
          case 2:  
            if (target instanceof Array)
              target[prop] = placeholder;
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
  
  exports.diff = diff;
  exports.patch = patch;
  exports.reverse = reverse;
});
