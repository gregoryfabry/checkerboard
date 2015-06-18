var expect = require("chai").expect;
var clone = require('clone');

var Client = require('../lib/checkerboard.js');


describe('Client', function(){
  describe('Utility', function(){
    describe('DiffableStateFactory', function() {

      var DSF;
      var data = {
        'arrayEmpty': [],
        'arrayOfNumbers': [1, 2, 3, 4, 5],
        'arrayOfObjects': [{a:0},{b:1},{c:2}],
        'arrayOfUndefined': [undefined, undefined, undefined, 4, 5, 6],
        'arrayOfNull': [null, null, null, 4, 5, 6],
        'objectEmpty': {},
        'objectWithNumbers': {a:0,b:1,c:2},
        'objectWithArrays': {a:[1,2,3],b:[4,5,6]},
        'objectWithObjects': {a:{x:0},b:{y:1}},
        'objectWithUndefineds': {a:undefined,b:undefined,c:0,d:1},
        'objectWithNulls': {a:null,b:null,c:0,d:1},
        'nullProperty': null,
        'undefinedProperty': undefined,
        'numberProperty': 42,
        'stringProperty': 'hello, world',
      };

      beforeEach(function() {
        DSF = new Client.Utility.DiffableStateFactory(data);
      });

      it('returns contents unmodified when no change', function() {
        var merged = DSF().merge();
        expect(merged).to.deep.equal(data);
      });

      it('overwrites an empty array', function() {
        DSF('arrayEmpty', [1, 2, 3, 4, 5]);

        expect(DSF('arrayEmpty')).to.deep.equal([1, 2, 3, 4, 5]);
        expect(DSF().diff).to.deep.equal({arrayEmpty:[]});
        expect(DSF().patch).to.deep.equal({arrayEmpty:{$set:[1, 2, 3, 4, 5]}});

        var merged = DSF().merge();
        expect(merged.arrayEmpty).to.deep.equal([1, 2, 3, 4, 5]);
      });

      it('overwrites a nonempty array', function() {
        DSF('arrayOfNumbers', [6, 7, 8]);

        expect(DSF('arrayOfNumbers')).to.deep.equal([6, 7, 8]);
        expect(DSF().diff).to.deep.equal({arrayOfNumbers:[1, 2, 3, 4, 5]});
        expect(DSF().patch).to.deep.equal({arrayOfNumbers:{$set:[6, 7, 8]}});

        var merged = DSF().merge();
        var expected = clone(data);
        expected.arrayOfNumbers = [6, 7, 8];
        expect(merged).to.deep.equal(expected);
      });

      it('overwrites a single value of an array', function() {
        DSF.arrayOfNumbers(2, 6);

        expect(DSF.arrayOfNumbers(2)).to.equal(6);
        expect(DSF().diff).to.deep.equal({arrayOfNumbers:[, , 3]});
        expect(DSF().patch).to.deep.equal({arrayOfNumbers:[, , 6]});

        var merged = DSF().merge();
        var expected = clone(data);
        expected.arrayOfNumbers[2] = 6;
        expect(merged).to.deep.equal(expected);
      });

      it('updates undefined value of an array', function() {
        DSF.arrayOfUndefined(2, 6);

        expect(DSF.arrayOfUndefined(2)).to.equal(6);
        expect(DSF().diff).to.deep.equal({arrayOfUndefined:[, , '__undefined__']});
        expect(DSF().patch).to.deep.equal({arrayOfUndefined:[, , 6]});

        var merged = DSF().merge();
        var expected = clone(data);
        expected.arrayOfUndefined[2] = 6;
        expect(merged).to.deep.equal(expected);
      });

      it('updates null value of an array', function() {
        DSF.arrayOfNull(2, 6);

        expect(DSF.arrayOfNull(2)).to.equal(6);
        expect(DSF().diff).to.deep.equal({arrayOfNull:[, , '__null__']});
        expect(DSF().patch).to.deep.equal({arrayOfNull:[, , 6]});

        var merged = DSF().merge();
        var expected = clone(data);
        expected.arrayOfNull[2] = 6;
        expect(merged).to.deep.equal(expected);
      });

      it('sets value of an array to undefined', function() {
        DSF.arrayOfNumbers(2, undefined);

        expect(DSF.arrayOfNumbers(2)).to.equal(undefined);
        expect(DSF().diff).to.deep.equal({arrayOfNumbers:[, , 3]});
        expect(DSF().patch).to.deep.equal({arrayOfNumbers:[, , '__undefined__']});

        var merged = DSF().merge();
        var expected = clone(data);
        expected.arrayOfNumbers[2] = undefined;
        expect(merged).to.deep.equal(expected);
      });

      it('sets value of an array to null', function() {
        DSF.arrayOfNumbers(2, null);

        expect(DSF.arrayOfNumbers(2)).to.equal(null);
        expect(DSF().diff).to.deep.equal({arrayOfNumbers:[, , 3]});
        expect(DSF().patch).to.deep.equal({arrayOfNumbers:[, , '__null__']});

        var merged = DSF().merge();
        var expected = clone(data);
        expected.arrayOfNumbers[2] = null;
        expect(merged).to.deep.equal(expected);
      });


    });
  });
});
