var expect = require("chai").expect;
var Client = require('../lib/checkerboard.js');

describe('Client', function(){
  describe('#Utility', function(){
    describe('isPOJS()', function() {
      it('should return false for a number', function() {
        expect(Client.Utility.isPOJS(5)).to.equal(false);
      });
    });
  });
});
