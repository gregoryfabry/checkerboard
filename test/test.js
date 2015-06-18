var expect = require("chai").expect;
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
        'arrayOfEmptyArrays': [[],[],[]],
        'arrayOfNumberArrays': [[1,2],[3,4],[5,6]],
        'arrayOfObjectArrays': [[{a:0},{b:1}],[{c:2},{d:3}]],
        'arrayOfUndefinedArrays':[[undefined, undefined],[undefined,undefined]],
        'arrayOfNullArrays':[[null,null],[null,null]],
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
        var expected = Object.create(data);
        expected.arrayOfNumbers = [6, 7, 8];
        expect(merged).to.deep.equal(expected);
      });


    });
  });
});
